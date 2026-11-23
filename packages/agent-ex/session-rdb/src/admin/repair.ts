// 坏会话的三个修法：**逐会话**的动作，只碰目标会话（别的会话的坏数据不连坐）。
//
// 三种修法各自对应一类「读不出来」：
// - drop-tail：只丢「最后一个可读边界之后」的尾部——可读边界是第一条解析不出来或序号断号的行，
//   边界之前的事件原样保留（head 跟着收）。
// - rewrite：按同一个边界把可读前缀整段重写（复用写路径的 replaceSessionLog：截断 / 重写 /
//   head 复位 / seed 收缩在同一个事务里），修完的日志形状一定自洽。
// - delete：走现有删除守卫（已归档、非运行中），坏的会话连根拔掉。
import { SessionId } from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionHeader } from "@morlay/dsh-session/contract";
import type { Backend, EventRow, SessionRow } from "../data/backend.ts";
import { SessionStoreError } from "../data/errors.ts";
import { rowToEvent, rowToMeta } from "../data/store/log/rows.ts";
import type {
  SessionRepairAction,
  SessionRepairValue,
} from "../endpoint/session-admin-endpoint.ts";
import type { DerivationRepairReport } from "./consistency.ts";
import { sessionNotFound } from "./locate.ts";

/** 修法要的端口：读面、写路径、运行中判据与删除守卫（它们都不认识门面类）。 */
export interface RepairDeps {
  ready(): Promise<void>;
  backend(): Backend;
  // 「运行中」的判据在写侧的两本账（还有写句柄，或还有没物化的 pending）：修法要动一条写完的日志。
  isLive(id: string): boolean;
  // 整段重写：写路径的 replaceSessionLog（截断 + 重写 + head 复位 + seed 收缩同事务）。
  replaceLog(
    id: string,
    meta: SessionHeader,
    inheritedEventCount: number,
    events: readonly SessionEvent[],
  ): Promise<void>;
  // 删除：管理面的既有守卫（已归档、非运行中），修法不另立一套判据。
  deleteSession(
    id: string,
  ): Promise<{ readonly sessionId: string; readonly repair: DerivationRepairReport }>;
}

/**
 * 最后一个可读边界：从头逐行读，第一条解析不出来或序号断号的行就是边界（它自己不可读）。
 *
 * 与读路径的 `scanRows` 有意不同：`scanRows` 对「已提交区里的坏行」直接拒绝（读的时候不该猜），
 * 而修复要的是**定位**那条坏行，所以这里把它当作边界而不是抛出去。
 * @param rows - 会话的事件行（按序号升序）。
 * @returns 边界下标（等于行数表示整段都可读）。
 */
export function readableBoundary(rows: readonly EventRow[]): number {
  const base = Number(rows[0]?.fSequence ?? 0);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) return index;
    if (Number(row.fSequence) !== base + index) return index;
    try {
      rowToEvent(row);
    } catch {
      /* 这一行解不出来：它就是可读边界。 */
      return index;
    }
  }
  return rows.length;
}

/**
 * 三个修法的入口。
 * @param deps - 读面 / 写路径 / 删除守卫。
 * @returns 门面逐个转发的方法。
 */
export function createRepair(deps: RepairDeps) {
  return {
    /**
     * 修一个坏会话。
     * @param sessionId - 会话 id。
     * @param action - 修法（丢坏尾部 / 整段重写 / 删除）。
     * @returns 修完保留与丢弃的事件条数。
     */
    async repairSession(
      sessionId: string,
      action: SessionRepairAction,
    ): Promise<SessionRepairValue> {
      await deps.ready();
      const backend = deps.backend();
      const row = await backend.reads.getSession(sessionId);
      if (row === undefined) throw sessionNotFound(sessionId);
      // 删除有自己的运行中守卫（在删除那一支里），两个日志修法在这里挡：正在写的日志不该被截断 / 重写。
      if (action !== "delete" && deps.isLive(sessionId)) {
        throw new SessionStoreError(
          "SESSION_LIVE",
          "session " + sessionId + " is live; stop it before repairing its log",
        );
      }
      // 事务原语收品牌 id：只在入口铸一次，内部一律用它。
      const id = SessionId(sessionId);
      switch (action) {
        case "drop-tail":
          return await this.dropTail(backend, id, row);
        case "rewrite":
          return await this.rewrite(backend, id, row);
        case "delete": {
          await deps.deleteSession(sessionId);
          return { sessionId, action, keptEvents: 0, droppedEvents: logLengthOf(row) };
        }
        default:
          // 契约上是三个修法的联合类型，wire 上仍是任意字符串：未知动作属于「入参不合法」，
          // 给域码而不是落到网关的兜底码（gateway/invoke-failed），客户端才分得出来。
          throw new SessionStoreError(
            "SESSION_REPAIR_INVALID_ACTION",
            `session-rdb: unsupported repair action "${String(action)}" for session "${sessionId}"`,
          );
      }
    },

    // 丢尾部：只删边界之后的桥接行、把 head 收回边界前一条、把种子段收进新日志长度，再按剩下的日志重算统计。
    async dropTail(
      backend: Backend,
      sessionId: SessionId,
      row: Pick<SessionRow, "fSeedLength">,
    ): Promise<SessionRepairValue> {
      const rows = await backend.reads.getEventRows(sessionId);
      const boundary = readableBoundary(rows);
      if (boundary >= rows.length) {
        return { sessionId, action: "drop-tail", keptEvents: rows.length, droppedEvents: 0 };
      }
      let removed: readonly string[] = [];
      await backend.transaction(async (tx) => {
        const previous =
          boundary === 0 ? undefined : await tx.getPrevBridge(sessionId, boundary - 1);
        removed = await tx.deleteBridgeTail(sessionId, boundary);
        await tx.updateHead(sessionId, previous?.fEventId ?? "", boundary - 1);
        // 种子段跟着收，与 rewrite 同口径（`min(seed, boundary)`）：边界落在种子段内时，光删尾部会留下
        // `seed > 日志长度`，那正是体检的 `seed-length-drift`——修法不该自己制造漂移。只收不扩。
        const seed = Number(row.fSeedLength ?? 0);
        if (seed > boundary) await tx.updateSeedLength(sessionId, boundary);
        await tx.bumpRevision(sessionId);
      });
      // 统计按剩下的日志重算；被删掉的那批桥接行让用量行的引用标记落回 0（与删除 / 覆盖导入同一口径）。
      await backend.rebuildSessionStats(sessionId);
      await backend.refreshEventUsageFlags(removed);
      return {
        sessionId,
        action: "drop-tail",
        keptEvents: boundary,
        droppedEvents: rows.length - boundary,
      };
    },

    // 整段重写：可读前缀重新落一遍（新事件行、head 与 seed 长度一起复位）。
    async rewrite(
      backend: Backend,
      sessionId: SessionId,
      row: SessionRow,
    ): Promise<SessionRepairValue> {
      const rows = await backend.reads.getEventRows(sessionId);
      const boundary = readableBoundary(rows);
      const events = rows.slice(0, boundary).map((event) => rowToEvent(event));
      const inherited = Math.min(Number(row.fSeedLength ?? 0), events.length);
      await deps.replaceLog(sessionId, rowToMeta(row), inherited, events);
      return {
        sessionId,
        action: "rewrite",
        keptEvents: events.length,
        droppedEvents: rows.length - events.length,
      };
    },
  };
}

// 日志长度：head + 1（删除时用它回报丢掉多少条）。
function logLengthOf(row: Pick<SessionRow, "fHeadSequence">): number {
  return Math.max(Number(row.fHeadSequence) + 1, 0);
}

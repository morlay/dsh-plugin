// rewind：把会话截到一个闭边界，并同步内存 log、写者位点与投影检查点。
//
// 直连存储做最小工作（不读全量日志）；旧格式才走 readLog（含格式转换与读视图修复）。
import { SessionLogOffset, type SessionEvent, type SessionId } from "@morlay/dsh-session/contract";
import type { SessionPersistenceSnapshot } from "@morlay/dsh-session-persistence/contract";
import {
  SessionBranchError,
  balanceRewindPrefix,
  rewindKeepLength as rewindKeepLengthOf,
} from "@morlay/session-rdb/endpoint";
import { isLegacyVersion } from "../read-view/legacy.ts";
import { rowToEvent, rowToMeta } from "../log/rows.ts";
import { assertRewindBoundary } from "./semantics.ts";
import { liveEventsOf, replaceLiveSessionLog, truncateLiveSession } from "./live-log.ts";
import type { ProjectionCacheSession } from "./provider.ts";
import type { SessionBranchRdbProvider } from "./provider.ts";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * 撤回（截断）一个会话。
 * @param provider - 分支行（端口与 live 钩子）。
 * @param id - 会话 id。
 * @param toBoundary - 保留边界的 seq（-1 表示清空）。
 * @param signal - 取消信号。
 * @returns 截断后的快照。
 */
export async function rewind(
  provider: SessionBranchRdbProvider,
  id: SessionId,
  toBoundary: number,
  signal?: AbortSignal,
): Promise<SessionPersistenceSnapshot> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(toBoundary) || toBoundary < -1) {
    throw new SessionBranchError(
      `rewind boundary must be a non-negative safe integer, got ${toBoundary}`,
      "INVALID_BOUNDARY",
    );
  }
  const live = provider.live.getSession(id);

  if (live !== undefined) await provider.live.flush(live);

  await provider.port.ready;

  // SessionBranch 是「先停止、再操作」的排他面（ADR-rewind绕过handle模型直接截断）：rewind 直连 DB 做最小工作，
  // 不走持久化抽象的全量读路径（readLog 会拉全部事件 + legacy 转换 + 读视图修复）。
  const row = await provider.port.sessionRow(id);
  if (row === undefined) {
    throw new SessionBranchError(`session "${id}" not found`, "SESSION_NOT_FOUND");
  }
  const meta = rowToMeta(row);

  let rawKeepLength: number;
  let kept: readonly SessionEvent[] | undefined;
  if (isLegacyVersion(row.fVersion)) {
    // 旧格式的持久化坐标与当前视图 seq 不一致：只有这条路径需要读日志（含格式转换与读视图修复）
    const log = await provider.port.readLog(id, {}, signal);
    if (log === undefined) {
      throw new SessionBranchError(`session "${id}" not found`, "SESSION_NOT_FOUND");
    }
    const boundaryType = log.events[toBoundary]?.type;
    assertRewindBoundary(id, toBoundary, boundaryType, log.events.length - 1);
    rawKeepLength =
      toBoundary === -1 ? 0 : boundaryType === "turn/end" ? toBoundary + 1 : toBoundary;
    kept = balanceRewindPrefix(log.events.slice(0, rawKeepLength));
  } else {
    const boundaryType =
      toBoundary === -1 ? undefined : await provider.port.eventTypeAt(id, toBoundary);
    assertRewindBoundary(id, toBoundary, boundaryType, row.fHeadSequence);
    rawKeepLength =
      toBoundary === -1 ? 0 : boundaryType === "turn/end" ? toBoundary + 1 : toBoundary;
  }
  const keepLength =
    kept === undefined ? await rewindKeepLength(provider, id, rawKeepLength) : kept.length;
  if (keepLength < rawKeepLength) {
    provider.live.warn?.(
      `session-rdb: rewind "${id}" dropped ${rawKeepLength - keepLength} trailing event(s) from seq ${keepLength} to keep the retained prefix's step pairs balanced`,
    );
  }

  const denseBoundary = keepLength - 1;
  const newSeedLength = await provider.port.transaction(async (tx) => {
    signal?.throwIfAborted();
    const head = await tx.getHead(id);
    if (denseBoundary > head.fHeadSequence) {
      throw new SessionBranchError(
        `rewind boundary ${toBoundary} is beyond the stored head ${head.fHeadSequence}`,
        "INVALID_BOUNDARY",
      );
    }
    // 截断前先挡并发写者：本实例 flush 之后另一实例提交的事件不该被当作尾部删掉。
    provider.port.guardHead(id, head.fHeadSequence);
    let nextHead: { fEventId: string; fSequence: number } | undefined;
    if (denseBoundary < head.fHeadSequence) {
      await tx.deleteBridgeTail(id, denseBoundary + 1);
      const prev = denseBoundary === -1 ? undefined : await tx.getPrevBridge(id, denseBoundary);
      nextHead =
        prev === undefined
          ? { fEventId: "", fSequence: -1 }
          : { fEventId: prev.fEventId, fSequence: prev.fSequence };
    }

    const storedSeedLength = await tx.getSeedLength(id);
    let shrunk = storedSeedLength;
    if (storedSeedLength !== null && storedSeedLength > denseBoundary + 1) {
      await tx.updateSeedLength(id, denseBoundary + 1);
      shrunk = denseBoundary + 1;
    }

    await tx.refreshTitle(id);
    // 撤回 / 重试是**现在**发生的活动：列表按「最近活动」（`f_last_event_at`）倒序，而重放出去的事件带的是
    // 它们原来的时间戳——只 bump revision 的话，被重试的会话会按创建时间沉到列表后面。
    const touchedAt = Date.now();
    if (nextHead === undefined) {
      await tx.bumpRevision(id, touchedAt);
    } else {
      // head 回退与 revision bump 是同一次行写：分成两条 UPDATE 就是两次行版本。
      await tx.updateHeadAndRevision(id, nextHead.fEventId, nextHead.fSequence, touchedAt);
    }
    return shrunk;
  });

  provider.port.confirmHead(id, denseBoundary);

  if (live !== undefined) {
    // 内存 log 与存储同源的判据：上游 `Session.append` 用 `log.length` 当 seq，所以「内存条目数 - 1」
    // 就是存储 head。内存**落后**于存储时（导入 / 取消与截断的竞态），不能拿内存做长度运算——
    // `log.length = n` 会在尾部补出空洞，之后每次 append 的 seq 都与存储错位，撤回边界就会点到
    // 存储里不存在的位置。落后就按存储前缀**整体重建**；`replaceLiveSessionLog` 顺手把 folds /
    // derived / surface 这些派生缓存一并清掉。
    const liveLength = (live as unknown as { log: readonly SessionEvent[] }).log.length;
    let lastTurn: number;
    if (liveLength < keepLength) {
      const prefix =
        kept ??
        (await provider.port.eventRows(id))
          .map(rowToEvent)
          .filter((event) => event.seq <= denseBoundary);
      replaceLiveSessionLog(live, prefix);
      lastTurn = prefix.findLast((event) => event.type === "turn/start")?.data.turn ?? 0;
    } else {
      lastTurn = truncateLiveSession(live, keepLength);
    }

    provider.live.resetProjections?.(live);

    provider.live.resetTokenMeter?.(live);
    const agent = provider.live.getAgent(id);
    if (agent !== undefined) {
      agent.requestHeaderLogged = false;

      const phase = (agent as unknown as { phase?: { lastTurn?: number } }).phase;
      if (phase !== undefined) phase.lastTurn = lastTurn;
    }

    provider.port.resetWriterAfterRewind(
      id,
      keepLength,
      newSeedLength === null ? undefined : newSeedLength,
    );

    agent?.inbox?.clear();

    // flush 是「把 live 缓冲尽力落库」：失败不该让撤回失败，也不该阻断下面的缓存刷新——
    // 撤回的正确性由库里的截断保证，缓存必须跟着新水位走，否则页面会一直显示撤回前的数据。
    try {
      await provider.live.flush(live);
    } catch (error: unknown) {
      provider.live.warn?.(
        `session-rdb: flush after rewind for "${id}" failed (the stored log is already truncated; live buffers may lag): ${describeError(error)}`,
      );
    }

    // 带上新水位：`write` 失败时缓存按这个水位截断兜底，而不是把撤回前的旧快照留在读路径上。
    await refreshProjectionCache(provider, {
      id: live.id,
      header: live.header,
      inheritedEventCount: live.inheritedEventCount,
      headSeq: keepLength - 1,
      // 检查点以**撤回后的内存 log** 为源：这是派生状态的重算，不是一次查询读——落库失败也要写回
      // （判据见 projection-cache.spec「flush 抛错时仍按内存 log 写回检查点」）。
      snapshotEvents: () => liveEventsOf(live),
    });
  } else {
    // rewind 不读日志：缓存行按新水位截断（保留下来的投影单元仍在截断前缀内）
    await refreshProjectionCache(provider, {
      id,
      header: meta,
      inheritedEventCount: SessionLogOffset(newSeedLength ?? row.fSeedLength ?? 0),
      headSeq: keepLength - 1,
      snapshotEvents: () => [],
    });
  }

  // 撤回不改统计：请求已发起就已经消耗过（见 ADR-撤回不回退统计）。
  return { header: rowToMeta(row), revision: (await provider.port.readStoredRevision(id))! };
}

// 保留长度只依赖尾部窗口：从 rawKeepLength 往回读类型（有界），窗口没覆盖到最近一个 turn/end
// 就翻倍重读，直到覆盖或到达前缀开头。
async function rewindKeepLength(
  provider: SessionBranchRdbProvider,
  id: SessionId,
  rawKeepLength: number,
): Promise<number> {
  if (rawKeepLength === 0) return 0;
  let limit = 64;
  for (;;) {
    const rows = await provider.port.eventTypesBefore(id, rawKeepLength, limit);
    const types = [...rows].reverse().map((row) => row.fType);
    const windowStart = rawKeepLength - types.length;
    if (types.includes("turn/end") || windowStart === 0 || types.length >= rawKeepLength) {
      return rewindKeepLengthOf(types, rawKeepLength);
    }
    limit *= 4;
  }
}

async function refreshProjectionCache(
  provider: SessionBranchRdbProvider,
  session: ProjectionCacheSession,
): Promise<void> {
  if (provider.live.refreshProjectionCache === undefined) return;
  try {
    await provider.live.refreshProjectionCache(session);
  } catch {}
}

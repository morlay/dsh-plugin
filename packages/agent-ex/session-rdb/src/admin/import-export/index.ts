// 导入的落库面：解析（./parse.ts）之后按 handle 模型写入（或在一个事务里整段替换）。
//
// 覆盖导入的原子性由写路径的 replaceSessionLog 保证；这里只做「目标是否运行中」的拒绝与 live 失效。
import { randomUUID } from "node:crypto";
import { SessionId, SessionLogOffset } from "@morlay/dsh-session/contract";
import type { Session, SessionEvent, SessionHeader } from "@morlay/dsh-session/contract";
import type { SessionStorageMetadata } from "@morlay/dsh-session-persistence/contract";
import { balanceRewindPrefix } from "@morlay/session-rdb/endpoint";
import { SessionStoreError, failureCodeOf } from "../../data/errors.ts";
import type {
  SessionImportBatchItem,
  SessionImportBatchResult,
} from "../../contract/session-rdb-store.contract.ts";
import { parseImportZip } from "./parse.ts";

// 落库需要的宿主面：句柄的三个入口、撤回后的 live 失效与 agent 停止。
export interface ImportHost {
  create(header: SessionHeader, inheritedEventCount: number): Promise<ImportHandle>;
  // 覆盖导入的唯一入口：截断 + 重写 + head 复位 + seed 长度收缩是一个事务。
  replace(
    id: SessionId,
    header: SessionHeader,
    inheritedEventCount: number,
    events: readonly SessionEvent[],
  ): Promise<void>;
  // 覆盖之后内存里的会话日志要整体换成新的一段（存储与内存不能各说一套）。
  replaceLiveLog(id: SessionId, events: readonly SessionEvent[]): void;
  resetLiveDerivedState(session: unknown): void;
  readonly sessions: { get(id: SessionId): unknown };
  stopLoop(id: SessionId): Promise<void>;
}

// 只声明导入用到的四个成员（`SessionHandle` 的其余面在这里没有调用方）。
export interface ImportHandle {
  append(events: readonly SessionEvent[]): Promise<void>;
  close(): Promise<void>;
}

export async function persistImport(
  host: ImportHost,
  imported: SessionStorageMetadata & { events: SessionEvent[] },
  targetId?: SessionId,
): Promise<SessionId> {
  // 整段导入的日志先配平：已不平衡的尾部会让接收会话的 token-meter 折叠在续写时报 step/end 无配对；
  // 尾部未闭合的 step 是中断运行的正常形状，由上游 resume 补 closers，保持原样。
  const events = balanceRewindPrefix(imported.events, { keepOpenTail: true });
  const inheritedEventCount = importedSeedLength(imported, events);
  if (targetId !== undefined) {
    await host.stopLoop(targetId);
    // 一次事务替换整段日志：失败时原会话完好（seed 长度也跟着新 head 收缩）。
    await host.replace(
      targetId,
      rootHeaderOf(imported.meta, targetId),
      inheritedEventCount,
      events,
    );
    const live = host.sessions.get(targetId);
    if (live !== undefined) {
      host.replaceLiveLog(targetId, events);
      host.resetLiveDerivedState(live);
    }
    return targetId;
  }

  const id = toSessionId(`session-${randomUUID()}`);
  const handle = await host.create(rootHeaderOf(imported.meta, id), inheritedEventCount);
  try {
    if (events.length > 0) await handle.append(events);
  } finally {
    // 追加失败也要释放写声明：否则同 id 不能重试、列表里多一条幽灵、删除一律判「运行中」。
    await handle.close();
  }
  return id;
}

export async function importZipIntoStore(
  host: ImportHost,
  zip: Uint8Array,
  targetId?: SessionId,
): Promise<SessionId> {
  return await persistImport(host, await parseImportZip(zip), targetId);
}

/**
 * 导入的会话是**根会话**：header 里的父引用不落库。
 *
 * 单条会话的导入不携带它的父会话；而 `origin: "subagent"` 加上父会话不在库里正是 `organize` 的孤儿判据
 * （`listOrphanSubagentSessions`），保留悬空的父引用等于让导入的会话在下一次整理时被删掉。子代理标记
 * 与父引用同生共死，所以一起丢掉（`delegationDepth` 留原值：它说的是这棵树有多深，不是引用）。
 * @param meta - 被导入的 header。
 * @param id - 这个库里的会话身份（新建导入是新铸的，覆盖导入是目标会话）。
 * @returns 去掉父引用与子代理标记的 header。
 */
function rootHeaderOf(meta: SessionHeader, id: SessionId): SessionHeader {
  return {
    version: meta.version,
    id,
    createdAt: meta.createdAt,
    ...(meta.cwd === undefined ? {} : { cwd: meta.cwd }),
    isSeeded: meta.isSeeded,
    ...(meta.delegationDepth === undefined ? {} : { delegationDepth: meta.delegationDepth }),
    ...(meta.agentPreset === undefined ? {} : { agentPreset: meta.agentPreset }),
  };
}

/**
 * 导入后要落库的 `f_seed_length`：写路径按 `isSeeded ? inheritedEventCount : null` 决定它，所以继承前缀
 * 只能来自种子会话，且必须收在配平后的日志长度之内（长过新 head 的种子长度会让整条会话读不出来）。
 * @param imported - 解析出来的导入件。
 * @param events - 配平后的日志。
 * @returns 继承前缀长度；未种子的会话恒为 0。
 */
function importedSeedLength(
  imported: SessionStorageMetadata & { events: SessionEvent[] },
  events: readonly SessionEvent[],
): SessionLogOffset {
  if (!imported.meta.isSeeded) return SessionLogOffset(0);
  return SessionLogOffset(Math.min(imported.inheritedEventCount, events.length));
}

function toSessionId(id: string): SessionId {
  return SessionId(id);
}

/** 导入落库要的宿主面：门面把自己的句柄入口与 live 失效钩子交进来。 */
export interface ImporterDeps {
  ready(): Promise<void>;
  create(header: SessionHeader, inheritedEventCount: number): Promise<ImportHandle>;
  hasOpenHandle(id: SessionId): boolean;
  replace(
    id: SessionId,
    header: SessionHeader,
    inheritedEventCount: number,
    events: readonly SessionEvent[],
  ): Promise<void>;
  liveSession(id: SessionId): Session | undefined;
  replaceLiveLog(live: Session, events: readonly SessionEvent[]): void;
  resetLiveDerivedState(session: Session): void;
  stopLoop(id: SessionId): Promise<void>;
}

// 落库宿主面：门面的句柄与 live 钩子接成 `ImportHost`（单条与批量导入共用一份接线）。
function hostOf(deps: ImporterDeps): ImportHost {
  return {
    create: (header, inherited) => deps.create(header, inherited),
    replace: async (id, header, inheritedEventCount, events) => {
      // 覆盖是破坏性动作：还有打开的句柄（正在运行）就拒绝，不赌「停 agent 之后就没人写」。
      if (deps.hasOpenHandle(id)) {
        throw new SessionStoreError(
          "SESSION_IMPORT_LIVE",
          "session " + id + " is open; close it before importing over it",
        );
      }
      await deps.replace(id, header, inheritedEventCount, events);
    },
    replaceLiveLog: (id, events) => {
      const live = deps.liveSession(id);
      if (live !== undefined) deps.replaceLiveLog(live, events);
    },
    resetLiveDerivedState: (session) => deps.resetLiveDerivedState(session as Session),
    sessions: { get: (id) => deps.liveSession(id) },
    stopLoop: (id) => deps.stopLoop(id),
  };
}

/**
 * 导入入口：解析 zip 并落成一个（或整体替换一个）会话。
 * @param deps - 门面的句柄与 live 钩子。
 * @returns 导入方法（门面转发）。
 */
export function createImporter(deps: ImporterDeps) {
  return {
    async importZip(zip: Uint8Array, targetId?: string): Promise<string> {
      await deps.ready();
      return await importZipIntoStore(
        hostOf(deps),
        zip,
        targetId === undefined ? undefined : SessionId(targetId),
      );
    },

    /**
     * 批量导入：逐条解析并落成新会话，逐条结算。
     *
     * 每条先认包里的 artifact 名（`parseSessionFormatLogFilename` 的口径），它同时是失败条的身份：
     * 失败条没有新会话 id（没建成），包也认不出来时文件名缺省。
     * @param zips - 导入包。
     * @returns 逐条结果（顺序与入参一致，坏包不影响其它包）。
     */
    async importMany(zips: readonly Uint8Array[]): Promise<SessionImportBatchResult> {
      await deps.ready();
      const host = hostOf(deps);
      const items: SessionImportBatchItem[] = [];
      for (const zip of zips) {
        let filename: string | undefined;
        try {
          const parsed = await parseImportZip(zip);
          filename = parsed.filename;
          const sessionId = await persistImport(host, parsed);
          items.push({ sessionId, ok: true, filename });
        } catch (error: unknown) {
          const code = failureCodeOf(error);
          // 失败条**没有建成**：不给 sessionId（空串会把"没有身份"伪装成一个身份）。
          items.push({
            ok: false,
            ...(code === undefined ? {} : { code }),
            ...(filename === undefined ? {} : { filename }),
          });
        }
      }
      return { items };
    },
  };
}

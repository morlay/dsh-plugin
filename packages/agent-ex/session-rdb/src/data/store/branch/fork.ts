// fork：把源会话的闭合前缀（含 seed 后缀）落成一个新的种子会话。
//
// 前缀的事件行能复用就复用（同一份事件行、不复制内容）；读视图来自迁移链时按内容复制。
import {
  SESSION_FORMAT_VERSION,
  SessionLogOffset,
  type SessionHeader,
  type SessionId,
} from "@morlay/dsh-session/contract";
import {
  SessionBranchError,
  balanceRewindPrefix,
  type ForkFromOptions,
} from "@morlay/session-rdb/endpoint";
import { locateTurnEnd, mintSessionId, renumber } from "./semantics.ts";
import type { SessionBranchRdbProvider } from "./provider.ts";

/**
 * 从源会话 fork 一个子会话。
 * @param provider - 分支行（端口与 live 钩子）。
 * @param sourceId - 源会话。
 * @param options - 锚点、seed 后缀与子会话 header 覆盖。
 * @param signal - 取消信号。
 * @returns 子会话 id。
 */
export async function forkFrom(
  provider: SessionBranchRdbProvider,
  sourceId: SessionId,
  options: ForkFromOptions = {},
  signal?: AbortSignal,
): Promise<SessionId> {
  signal?.throwIfAborted();
  const { atSeq, anchorMode = "after", seedSuffix = [], childSessionId, meta = {} } = options;
  const source = await provider.port.readLog(sourceId, {}, signal);
  if (source === undefined)
    throw new SessionBranchError(`session "${sourceId}" not found`, "SESSION_NOT_FOUND");
  const boundary = locateTurnEnd(source.events, atSeq, anchorMode);
  const prefix = balanceRewindPrefix(source.events.slice(0, boundary + 1));
  if (prefix.length <= boundary) {
    provider.live.warn?.(
      `session-rdb: fork "${sourceId}" dropped ${boundary + 1 - prefix.length} trailing event(s) from seq ${prefix.length} to keep the seed's step pairs balanced`,
    );
  }
  const childId = childSessionId ?? mintSessionId();
  const childMeta: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: childId,
    createdAt: meta.createdAt ?? Date.now(),
    ...(meta.cwd !== undefined
      ? { cwd: meta.cwd }
      : source.meta.cwd !== undefined
        ? { cwd: source.meta.cwd }
        : {}),
    parentSession: sourceId,
    isSeeded: true,
    ...(meta.agentPreset !== undefined
      ? { agentPreset: meta.agentPreset }
      : source.meta.agentPreset !== undefined
        ? { agentPreset: source.meta.agentPreset }
        : {}),
    ...(meta.origin !== undefined ? { origin: meta.origin } : {}),
    ...(meta.delegationDepth !== undefined ? { delegationDepth: meta.delegationDepth } : {}),
  };
  const seed = [...renumber(prefix, 0), ...renumber(seedSuffix, prefix.length)];

  await provider.port.ready;
  // 复用父会话的事件行有个前提：**读取视图的 seq 与存储行的 f_sequence 一一对应**。legacy 会话的读视图
  // 由迁移链重建（可能重新编号、增删事件），按 seq 复用会把桥接行挂到语义不符的行上——读取时按 `f_data`
  // 解析，子会话前缀读到的内容就会和它自己的 seed 事件对不上。那种情况下复制事件行（多几行存储，正确优先）。
  const reusable = !source.migrated && source.events.length === source.storedCount;
  const reuse = new Map<number, string>();
  if (reusable) {
    const sourceRows = await provider.port.eventRows(sourceId);
    const sourceEventIds = new Map(sourceRows.map((row) => [row.fSequence, row.fEventId]));
    for (const event of prefix) {
      const eventId = sourceEventIds.get(event.seq);
      if (eventId !== undefined) reuse.set(event.seq, eventId);
    }
  } else if (prefix.length > 0) {
    provider.live.warn?.(
      `session-rdb: fork "${sourceId}" copies event rows instead of reusing them — its read view comes from a migration, so stored seqs need not line up`,
    );
  }
  provider.port.registerReuseEventIds(childId, reuse);
  try {
    const handle = await provider.port.create(childMeta, {
      inheritedEventCount: SessionLogOffset(prefix.length),
    });
    try {
      if (seed.length > 0) await handle.append(seed);
    } finally {
      await handle.close();
    }
  } catch (error) {
    // fork 没成（id 已存在、append 失败等）：别把复用映射留在进程里——同一个 childId 之后的落写会按它
    // 去复用父会话的事件行，而那条会话可能完全无关。
    provider.port.dropReuseEventIds(childId);
    throw error;
  }
  // fork 不动统计：继承前缀的消耗是父会话真实发生的那一次，子会话只记自己新产生的
  // （写路径旁路累加，见 ADR-fork不继承统计）。
  return childId;
}

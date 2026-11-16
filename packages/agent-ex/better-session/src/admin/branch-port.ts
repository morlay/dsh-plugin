// 分支端口：把数据面的行级入口接成 SessionBranch 的端口（分支行只认这一个面）。
//
// 端口形状见 data/store/branch/port.ts；这里只做接线，不含分支语义。
import type { SessionHandle } from "@morlay/dsh-session-persistence/contract";
import type { Backend } from "../data/backend.ts";
import type { SessionId, SessionHeader } from "@morlay/dsh-session/contract";
import type { BranchPort } from "../data/store/branch/port.ts";
import type { RdbLogView } from "../data/store/host.ts";
import type { WriteGuard } from "../data/write-guard.ts";

/** 分支端口的接线面：门面把自己的一行行能力交进来。 */
export interface BranchPortDeps {
  ready(): Promise<void>;
  backend(): Backend;
  readonly writeGuard: WriteGuard;
  readLog(
    id: SessionId,
    options?: { fromSeq?: number },
    signal?: AbortSignal,
  ): Promise<RdbLogView | undefined>;
  create(meta: SessionHeader, options?: { inheritedEventCount?: number }): Promise<SessionHandle>;
  readStoredRevision(id: SessionId): Promise<SessionPersistenceRevisionLike | undefined>;
  registerReuse(childId: SessionId, map: ReadonlyMap<number, string>): void;
  dropReuse(childId: SessionId): void;
  resetWriterAfterRewind(id: SessionId, cursor: number, inheritedEventCount?: number): void;
  resetLiveDerivedState(session: unknown): void;
}

type SessionPersistenceRevisionLike = Awaited<ReturnType<BranchPort["readStoredRevision"]>>;

/**
 * 分支端口接线。
 * @param deps - 门面的行级能力。
 * @returns SessionBranch 端口。
 */
export function createBranchPort(deps: BranchPortDeps): BranchPort {
  return {
    ready: deps.ready(),
    readLog: (id, options, signal) => deps.readLog(id, options ?? {}, signal),
    create: (meta, options) => deps.create(meta, options),
    eventRows: (id, fromSequence) => deps.backend().reads.getEventRows(id, fromSequence),
    eventTypesBefore: (id, before, limit) =>
      deps.backend().reads.getEventTypesBefore(id, before, limit),
    sessionRow: (id) => deps.backend().reads.getSession(id),
    eventTypeAt: (id, sequence) => deps.backend().reads.getEventTypeAt(id, sequence),
    transaction: (fn) => deps.backend().transaction(fn),
    confirmHead: (id, sequence) => deps.writeGuard.confirmHead(id, sequence),
    guardHead: (id, storedHead) => {
      if (!deps.writeGuard.has(id)) deps.writeGuard.confirmHead(id, storedHead);
      deps.writeGuard.assertNoConcurrentWriter(id, storedHead);
    },
    readStoredRevision: (id) => deps.readStoredRevision(id),
    registerReuseEventIds: (childId, map) => deps.registerReuse(childId, map),
    dropReuseEventIds: (childId) => deps.dropReuse(childId),
    resetWriterAfterRewind: (id, cursor, inheritedEventCount) => {
      deps.resetWriterAfterRewind(id, cursor, inheritedEventCount);
    },
  };
}

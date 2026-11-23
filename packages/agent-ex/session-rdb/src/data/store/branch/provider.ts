// 分支行的提供者骨架：端口 + live 钩子、前缀读取，fork / rewind 在各自文件里实现。
import {
  type Session,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionLogOffset,
} from "@morlay/dsh-session/contract";
import type { SessionPersistenceSnapshot } from "@morlay/dsh-session-persistence/contract";
import {
  SessionBranchError,
  type BranchAnchorMode,
  type BranchBoundary,
  type ForkFromOptions,
} from "@morlay/session-rdb/endpoint";
import type { BranchPort } from "./port.ts";
import { locateTurnEnd } from "./semantics.ts";
import { forkFrom } from "./fork.ts";
import { rewind } from "./rewind.ts";

export interface LiveSessionHooks {
  getSession(id: SessionId): Session | undefined;

  getAgent(id: SessionId): LiveAgentLike | undefined;

  flush(session: Session): Promise<boolean>;

  warn?(message: string): void;

  resetProjections?(session: Session): void;

  resetTokenMeter?(session: Session): void;

  refreshProjectionCache?(session: ProjectionCacheSession): Promise<void>;
}

export interface SessionBranchProvider {
  readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode?: BranchAnchorMode,
    signal?: AbortSignal,
  ): Promise<BranchBoundary>;

  readRawEvents(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>;

  forkFrom(
    sourceId: SessionId,
    options?: ForkFromOptions,
    signal?: AbortSignal,
  ): Promise<SessionId>;

  rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot>;
}

export interface ProjectionCacheSession {
  readonly id: SessionId;
  readonly header: SessionHeader;
  readonly inheritedEventCount: SessionLogOffset;

  // 没有 live 会话时（cold rewind）缓存按这个新水位截断，不 fold 日志
  readonly headSeq?: number;
  snapshotEvents(): readonly SessionEvent[];
}

export interface LiveAgentLike {
  session: Session;

  requestHeaderLogged?: boolean;

  inbox?: { clear(): void };
}

export class SessionBranchRdbProvider implements SessionBranchProvider {
  readonly name = "session-rdb";

  constructor(
    readonly port: BranchPort,

    readonly live: LiveSessionHooks = {
      getSession: () => undefined,
      getAgent: () => undefined,
      flush: async () => true,
    },
  ) {}

  async readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode: BranchAnchorMode = "after",
    signal?: AbortSignal,
  ): Promise<BranchBoundary> {
    const { events } = await this.readRawEvents(id, signal);
    const boundary = locateTurnEnd(events, atSeq, mode);
    return { seq: boundary, events: events.slice(0, boundary + 1) };
  }

  async readRawEvents(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
    const stored = await this.port.readLog(id, {}, signal);
    if (stored === undefined)
      throw new SessionBranchError(`session "${id}" not found`, "SESSION_NOT_FOUND");
    return { meta: stored.meta, events: stored.events };
  }

  forkFrom(
    sourceId: SessionId,
    options?: ForkFromOptions,
    signal?: AbortSignal,
  ): Promise<SessionId> {
    return forkFrom(this, sourceId, options, signal);
  }

  rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot> {
    return rewind(this, id, toBoundary, signal);
  }
}

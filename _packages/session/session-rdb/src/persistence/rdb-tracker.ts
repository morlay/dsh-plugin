// 打开句柄与 pending 会话的登记：写路径的互斥（claimWrite / writerOf）都在这里。
import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistenceRevision,
} from "@deepseek-ai/dsh-session-persistence";
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from "@deepseek-ai/dsh-session";

export interface PendingSession {
  readonly header: SessionHeader;
  readonly revision: SessionPersistenceRevision;
  readonly inheritedEventCount: SessionLogOffset;

  readonly cursor: number;

  readonly everAppended: boolean;
}

// 句柄的结构面：tracker 只需要这些（不反向依赖具体 handle 类）。
export interface TrackerHandle {
  readonly id: SessionId;

  readonly access: "read" | "write";

  enqueueLive(event: SessionEvent, onError: (error: unknown) => void): void;

  append(events: readonly SessionEvent[]): Promise<void>;

  resetAfterRewind(keepLength: number, newSeedLength?: number): void;

  drainLive(): Promise<void>;

  flush(): Promise<void>;

  close(): Promise<void>;
}

export class RdbBackendTracker {
  private readonly writers = new Map<SessionId, TrackerHandle | null>();
  private readonly pending = new Map<SessionId, PendingSession>();
  private readonly openHandles = new Set<TrackerHandle>();
  private counter = 0;

  constructor(private readonly name: string) {}

  registerCreated(header: SessionHeader, inheritedEventCount: SessionLogOffset): void {
    if (this.writers.has(header.id)) throw new SessionAlreadyExistsError(header.id);
    this.writers.set(header.id, null);
    this.pending.set(header.id, {
      header,
      revision: SessionPersistenceRevision(`memory:${this.name}:${++this.counter}`),
      inheritedEventCount,
      cursor: 0,
      everAppended: false,
    });
  }

  updatePending(id: SessionId, cursor: number, everAppended: boolean): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    this.pending.set(id, { ...entry, cursor, everAppended });
  }

  claimWrite(id: SessionId): void {
    if (this.writers.has(id)) throw new SessionAlreadyOwnedError(id);
    this.writers.set(id, null);
  }

  releaseClaim(id: SessionId): void {
    this.writers.delete(id);
  }

  pendingOf(id: SessionId): PendingSession | undefined {
    return this.pending.get(id);
  }

  hasPending(id: SessionId): boolean {
    return this.pending.has(id);
  }

  pendingEntries(): IterableIterator<[SessionId, PendingSession]> {
    return this.pending.entries();
  }

  materialized(id: SessionId): void {
    this.pending.delete(id);
  }

  adopt<T extends TrackerHandle>(handle: T): T {
    this.openHandles.add(handle);
    if (handle.access === "write") this.writers.set(handle.id, handle);
    return handle;
  }

  release(handle: TrackerHandle, materialized: boolean): void {
    this.openHandles.delete(handle);
    if (handle.access !== "write") return;
    this.writers.delete(handle.id);
    if (!materialized) this.pending.delete(handle.id);
  }

  writerOf(id: SessionId): TrackerHandle | undefined {
    const writer = this.writers.get(id);
    return writer === null ? undefined : writer;
  }

  hasOpenHandle(id: SessionId): boolean {
    for (const handle of this.openHandles) {
      if (handle.id === id) return true;
    }
    return false;
  }

  async flushAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const writer of this.writers.values()) {
      if (writer === null) continue;
      try {
        await writer.drainLive();
        await writer.flush();
      } catch (error: unknown) {
        if (error instanceof SessionHandleClosedError) continue;
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${this.name} flush failed`);
  }

  async closeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const handle of this.openHandles) {
      try {
        await handle.close();
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${this.name} dispose failed`);
  }
}

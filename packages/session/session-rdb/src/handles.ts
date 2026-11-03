import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  assertContiguous,
  materializeAppendBatch,
  type SessionAccess,
  type SessionHandle,
  type SessionHandleAppendOptions,
  type SessionHandleFlushOptions,
  type SessionHandleReadOptions,
  type SessionHandleReadResult,
} from "@deepseek-ai/dsh-session-persistence";
import { SessionLogOffset } from "@deepseek-ai/dsh-session";
import type { SessionEvent, SessionHeader, SessionId } from "@deepseek-ai/dsh-session";
import type { SessionPersistenceRdb } from "./session-store.ts";
import { repairReadView } from "./log/repair.ts";

interface PendingSession {
  readonly header: SessionHeader;
  readonly revision: SessionPersistenceRevision;
  readonly inheritedEventCount: SessionLogOffset;

  readonly cursor: number;

  readonly everAppended: boolean;
}

export class RdbBackendTracker {
  private readonly writers = new Map<SessionId, RdbSessionHandle | null>();
  private readonly pending = new Map<SessionId, PendingSession>();
  private readonly openHandles = new Set<RdbSessionHandle>();
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

  adopt(handle: RdbSessionHandle): RdbSessionHandle {
    this.openHandles.add(handle);
    if (handle.access === "write") this.writers.set(handle.id, handle);
    return handle;
  }

  release(handle: RdbSessionHandle, materialized: boolean): void {
    this.openHandles.delete(handle);
    if (handle.access !== "write") return;
    this.writers.delete(handle.id);
    if (!materialized) this.pending.delete(handle.id);
  }

  writerOf(id: SessionId): RdbSessionHandle | undefined {
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

export class RdbSessionHandle implements SessionHandle {
  private chain: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;

  private cursor: number;
  private materialized: boolean;

  private buffered: SessionEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private drainPaused = false;
  private draining: Promise<void> | undefined;

  private tornTruncateTo: number | undefined;

  private everAppended = false;

  constructor(
    private readonly persistence: SessionPersistenceRdb,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    private readonly state: {
      cursor: number;
      materialized: boolean;
      inheritedEventCount: SessionLogOffset;
      tornTruncateTo?: number;
    },
  ) {
    this.cursor = state.cursor;
    this.materialized = state.materialized;
    this.tornTruncateTo = state.tornTruncateTo;
  }

  get inheritedEventCount(): SessionLogOffset {
    return this.state.inheritedEventCount;
  }

  get cursorValue(): number {
    return this.cursor;
  }

  async read(
    offset = 0,
    length = Number.MAX_SAFE_INTEGER,
    options?: SessionHandleReadOptions,
  ): Promise<SessionHandleReadResult> {
    this.assertOpen("read");
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError(`read offset must be a non-negative safe integer, got ${String(offset)}`);
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TypeError(`read length must be a non-negative safe integer, got ${String(length)}`);
    }
    options?.signal?.throwIfAborted();
    const log = await this.persistence.readLog(this.id, {}, options?.signal);
    if (log === undefined) {
      if (this.persistence.tracker.hasPending(this.id)) {
        return { eventState: "detached", events: [] };
      }
      throw new SessionPersistenceNotFoundError(this.id);
    }

    repairReadView(log.events);
    return { eventState: "detached", events: log.events.slice(offset, offset + length) };
  }

  async append(
    events: readonly SessionEvent[],
    options?: SessionHandleAppendOptions,
  ): Promise<void> {
    this.assertOpen("append");
    const batch = materializeAppendBatch(events);
    return this.run("append", async () => {
      options?.signal?.throwIfAborted();
      if (this.access !== "write") throw new SessionReadOnlyError(this.id, "append");
      if (batch.length === 0) return;
      this.everAppended = true;
      assertContiguous(this.id, batch, this.cursor);
      await this.persistence.appendBatch(
        this.header,
        this.state.inheritedEventCount,
        batch,
        this.tornTruncateTo,
      );
      this.tornTruncateTo = undefined;

      this.cursor += batch.length;
      this.materialized = true;
      this.persistence.tracker.updatePending(this.id, this.cursor, true);
    });
  }

  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    return this.run("flush", async () => {
      options?.signal?.throwIfAborted();
      if (this.access !== "write") throw new SessionReadOnlyError(this.id, "flush");
      if (this.materialized) return;
      await this.persistence.materializeEmpty(this.header, this.state.inheritedEventCount);
      this.materialized = true;
    });
  }

  close(): Promise<void> {
    return (this.closing ??= (async () => {
      let drainFailure: unknown;
      for (;;) {
        try {
          await this.drainLive();
        } catch (error: unknown) {
          drainFailure = error;
          break;
        }
        await this.chain;
        if (this.buffered.length === 0) break;
      }
      await this.chain;
      const failures: Error[] = [];
      if (drainFailure !== undefined) {
        failures.push(
          drainFailure instanceof Error ? drainFailure : new Error(JSON.stringify(drainFailure)),
        );
      }
      this.persistence.tracker.release(this, this.materialized || this.everAppended);
      if (failures.length > 1)
        throw new AggregateError(failures, `session "${this.id}": close failed to drain`);
      if (failures[0] !== undefined) throw failures[0];
    })());
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  enqueueLive(event: SessionEvent, reportBackgroundFailure: (error: unknown) => void): void {
    this.buffered.push(structuredClone(event));
    if (this.batchTimer !== undefined || this.drainPaused) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      this.drainLive().catch(reportBackgroundFailure);
    }, RdbSessionHandle.LIVE_WRITE_BATCH_MAX_DELAY_MS);
  }

  resetAfterRewind(cursor: number, inheritedEventCount?: number): void {
    this.cursor = cursor;
    if (inheritedEventCount !== undefined) {
      (this.state as { inheritedEventCount: SessionLogOffset }).inheritedEventCount =
        SessionLogOffset(inheritedEventCount);
    }
  }

  drainLive(): Promise<void> {
    return (this.draining ??= this.drainBuffered().finally(() => {
      this.draining = undefined;
    }));
  }

  private async drainBuffered(): Promise<void> {
    if (this.batchTimer !== undefined) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    this.drainPaused = false;
    while (this.buffered.length > 0) {
      await this.enqueueChain(async () => {
        const batch = this.buffered.splice(0);
        try {
          const fresh = batch.filter((event) => event.seq >= this.cursor);
          if (fresh.length === 0) return;
          for (const [index, event] of fresh.entries()) {
            if (event.seq !== this.cursor + index) {
              throw new Error(
                `append seq mismatch for "${this.id}": expected ${this.cursor + index} at index ${index}, got ${event.seq}`,
              );
            }
          }
          await this.persistence.appendBatch(
            this.header,
            this.state.inheritedEventCount,
            fresh,
            this.tornTruncateTo,
          );
          this.tornTruncateTo = undefined;
          this.cursor += fresh.length;
          this.materialized = true;
        } catch (error: unknown) {
          this.buffered = batch.concat(this.buffered);
          this.drainPaused = true;
          throw error;
        }
      });
    }
  }

  private enqueueChain(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op);
    this.chain = next.catch(() => {});
    return next;
  }

  private async run(operation: string, op: () => Promise<void>): Promise<void> {
    this.assertOpen(operation);
    return this.enqueueChain(async () => {
      this.assertOpen(operation);
      return op();
    });
  }

  private assertOpen(operation: string): void {
    if (this.closing !== undefined) throw new SessionHandleClosedError(this.id, operation);
  }

  static readonly LIVE_WRITE_BATCH_MAX_DELAY_MS = 200;
}


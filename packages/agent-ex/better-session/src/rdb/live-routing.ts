// live 会话的写路由：把四个生命周期事件与四张内存表收在一处。
//
// 会话级的「缓冲—句柄—失败终态」都在这里；句柄自己的批量窗口在 `handles.ts`。
import type { Session, SessionEvent, SessionId } from "@morlay/dsh-session/contract";
import type { SessionHandle } from "@morlay/dsh-session-persistence/contract";
import type { RdbStoreHost } from "./host.ts";
import { liveEventsOf } from "./branch/index.ts";
import { repairReadView } from "./log/repair.ts";

// 持久化初始化失败是**终态**（cwd / 继承前缀冲突、id 碰撞、后端打不开都不自愈）：记一条错、丢掉已缓冲的
// 事件，之后该会话的事件不再进内存缓冲，flush 把失败抛回上游。

export interface LiveSessionSource {
  // 会话事件流：由装配层用事件类接上（`events.ts`）。
  readonly onCreated: (listener: (session: Session) => void) => () => boolean;
  readonly onEvent: (listener: (session: Session, event: SessionEvent) => void) => () => boolean;
  readonly onFlush: (listener: (session: Session) => Promise<void> | void) => () => boolean;
  readonly onDisposed: (listener: (session: Session) => void) => () => boolean;
}

export interface LiveRoutingDeps {
  readonly host: RdbStoreHost;
  readonly events: LiveSessionSource;
  // 已落库的会话要先过版本校验（与 handle 的 open 同一口径）。
  assertVersion(meta: { readonly version: number }): void;
  readLog(id: SessionId): Promise<
    | {
        meta: { version: number; cwd?: string };
        inheritedEventCount: number;
        events: SessionEvent[];
      }
    | undefined
  >;
  sessions(): readonly Session[];
  create(header: Session["header"], inheritedEventCount: unknown): Promise<SessionHandle>;
  openWrite(id: SessionId): Promise<SessionHandle>;
  warn(message: string): void;
  error(message: string): void;
  close(): Promise<void>;
}

// live 会话的写句柄：`SessionHandle` 加上批量窗口的入口。
export interface LiveHandle extends SessionHandle {
  enqueueLive(event: SessionEvent, reportBackgroundFailure: (error: unknown) => void): void;
  drainLive(): Promise<void>;
}

export class LiveRouting {
  private readonly buffers = new Map<SessionId, SessionEvent[]>();
  private readonly ready = new Map<SessionId, Promise<void>>();
  private readonly failures = new Map<SessionId, Error>();
  private readonly dropWarned = new Set<SessionId>();
  private readonly unsubscribes: Array<() => void> = [];

  constructor(private readonly deps: LiveRoutingDeps) {}

  // 丢掉一个会话的所有 live 记账（删除会话、孤儿会话回收时）。
  forget(id: SessionId): void {
    this.buffers.delete(id);
    this.ready.delete(id);
    this.failures.delete(id);
    this.dropWarned.delete(id);
  }

  install(): void {
    const { events } = this.deps;
    this.unsubscribes.push(events.onCreated((session) => this.track(session)));
    for (const session of this.deps.sessions()) this.track(session);

    this.unsubscribes.push(
      events.onEvent((session, event) => {
        const handle = this.writerOf(session.id);
        if (handle !== undefined) {
          handle.enqueueLive(event, (error) => {
            this.deps.warn(
              `session-rdb: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`,
            );
          });
          return;
        }
        if (this.failures.has(session.id)) {
          if (!this.dropWarned.has(session.id)) {
            this.dropWarned.add(session.id);
            this.deps.warn(
              `session-rdb: dropping events for live session "${session.id}" because persistence failed earlier`,
            );
          }
          return;
        }
        this.buffers.get(session.id)?.push(structuredClone(event));
      }),
    );

    this.unsubscribes.push(
      events.onFlush((session) => {
        const failure = this.failures.get(session.id);
        if (failure !== undefined) return Promise.reject(failure);
        const handle = this.writerOf(session.id);
        if (handle === undefined) {
          const ready = this.ready.get(session.id);
          if (ready === undefined) return undefined;
          return ready.then(() => {
            const settled = this.writerOf(session.id);
            if (settled === undefined) return undefined;
            return settled.drainLive().then(() => settled.flush());
          });
        }
        return handle.drainLive().then(() => handle.flush());
      }),
    );

    this.unsubscribes.push(
      events.onDisposed((session) => {
        const ready = this.ready.get(session.id);
        this.forget(session.id);
        const closeHandle = (): void => {
          const handle = this.writerOf(session.id);
          if (handle === undefined) return;
          handle.close().catch((error: unknown) => {
            this.deps.warn(
              `session-rdb: final drain for session "${session.id}" failed: ${String(error)}`,
            );
          });
        };
        if (ready === undefined) {
          closeHandle();
          return;
        }
        void ready.then(closeHandle, closeHandle);
      }),
    );
  }

  async shutdown(): Promise<void> {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    await Promise.allSettled(this.ready.values());
    this.buffers.clear();
    this.ready.clear();
    this.failures.clear();
    this.dropWarned.clear();
    await this.deps.close();
  }

  private track(session: Session): void {
    this.buffers.set(session.id, []);
    const ready = this.ensureHandle(session);
    this.ready.set(session.id, ready);
    void ready.catch((error: unknown) => {
      const failure =
        error instanceof Error
          ? error
          : new Error(
              typeof error === "string" ? error : `live session "${session.id}" persistence failed`,
            );
      this.failures.set(session.id, failure);
      this.buffers.delete(session.id);
      this.deps.error(
        `session-rdb: live session "${session.id}" persistence unavailable (${failure.message}); its events will not be persisted`,
      );
    });
  }

  private writerOf(id: SessionId): LiveHandle | undefined {
    return this.deps.host.tracker.writerOf(id) as LiveHandle | undefined;
  }

  private async ensureHandle(session: Session): Promise<void> {
    const id = session.header.id;
    if (this.writerOf(id) !== undefined) return;
    const stored = await this.deps.readLog(id);
    let handle: LiveHandle;
    if (stored === undefined) {
      handle = (await this.deps.create(session.header, session.inheritedEventCount)) as LiveHandle;
      // 建会话时带进来的 seed 已经在内存 log 里（早于写句柄存在），这里补落库：
      // 不补的话存储 head 停在 -1，rewind / fork 的边界校验会一律判"超出存储 head"。
      const seed = liveEventsOf(session);
      if (seed.length > 0) await handle.append(seed);
    } else {
      if (stored.meta.cwd !== session.header.cwd) {
        throw new Error(
          `session "${id}" is already persisted at a different cwd (persisted: ${String(stored.meta.cwd)}, live: ${String(session.header.cwd)}) (id collision)`,
        );
      }
      if (stored.inheritedEventCount !== session.inheritedEventCount) {
        throw new Error(
          `session "${id}" is already persisted with a different inherited event count (id collision)`,
        );
      }
      this.deps.assertVersion(stored.meta);
      repairReadView(stored.events);
      const seed = liveEventsOf(session);
      if (!seedCoversPrefix(seed, stored.events)) {
        throw new Error(
          `session "${id}" already has a persisted log on disk that does not match this live session (id collision)`,
        );
      }
      handle = (await this.deps.openWrite(id)) as LiveHandle;
      const suffix = seed.slice(stored.events.length);
      if (suffix.length > 0) await handle.append(suffix);
    }

    const buffered = this.buffers.get(id);
    if (buffered !== undefined && buffered.length > 0) {
      this.buffers.set(id, []);
      for (const event of buffered) handle.enqueueLive(event, () => {});
    }
  }
}

function seedCoversPrefix(seed: readonly SessionEvent[], prefix: readonly SessionEvent[]): boolean {
  return (
    prefix.length <= seed.length &&
    prefix.every((event, index) => {
      const seedEvent = seed[index];
      return seedEvent !== undefined && JSON.stringify(seedEvent) === JSON.stringify(event);
    })
  );
}

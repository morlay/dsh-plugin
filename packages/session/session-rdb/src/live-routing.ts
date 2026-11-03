import type { Context } from "@deepseek-ai/cordis";
import { assertVersion } from "@deepseek-ai/dsh-session-persistence";
import type { Session, SessionEvent, SessionId } from "@deepseek-ai/dsh-session";
import type { SessionHandle } from "@deepseek-ai/dsh-session-persistence";
import type { SessionPersistenceRdb } from "./session-store.ts";
import { liveEventsOf } from "./branch/index.ts";
import { repairReadView } from "./log/repair.ts";

/**
 * live 会话的写路由：把 `session/created|event|flush|disposed` 四个订阅与四张内存表收在一处。
 *
 * 会话级的「缓冲—句柄—失败终态」都收在这里；装配点是 `session-store.ts` 的构造函数（`new LiveRouting(ctx, this)`），
 * `forget(id)` 在删除会话 / 回收孤儿会话时调用。句柄自己的批量窗口在 `handles.ts`。
 */
/** live 会话的写句柄：`SessionHandle` 加上批量窗口的入口。 */
interface LiveHandle extends SessionHandle {
  enqueueLive(event: SessionEvent, reportBackgroundFailure: (error: unknown) => void): void;
}

export class LiveRouting {
  private readonly buffers = new Map<SessionId, SessionEvent[]>();
  private readonly ready = new Map<SessionId, Promise<void>>();
  // 持久化初始化失败是**终态**（cwd / 继承前缀冲突、id 碰撞、后端打不开都不自愈）：记账一条 error、
  // 丢掉已缓冲的事件，之后该会话的事件不再进内存缓冲（否则表现为「聊了一整轮、重启后全丢，
  // 内存里还留一份无界副本」），flush 把失败抛回上游。
  private readonly failures = new Map<SessionId, Error>();
  private readonly dropWarned = new Set<SessionId>();

  constructor(
    private readonly ctx: Context,
    private readonly persistence: SessionPersistenceRdb,
  ) {}

  /** 丢掉一个会话的所有 live 记账（删除会话、孤儿会话回收时）。 */
  forget(id: SessionId): void {
    this.buffers.delete(id);
    this.ready.delete(id);
    this.failures.delete(id);
    this.dropWarned.delete(id);
  }

  install(): void {
    const ctx = this.ctx;
    ctx.on("session/created", (session: Session) => {
      this.buffers.set(session.id, []);
      const ready = this.ensureHandle(session);
      this.ready.set(session.id, ready);
      this.watchReady(session, ready);
    });

    for (const session of ctx.sessions.list()) {
      this.buffers.set(session.id, []);
      const ready = this.ensureHandle(session);
      this.ready.set(session.id, ready);
      this.watchReady(session, ready);
    }

    ctx.on("session/event", (session: Session, event: SessionEvent) => {
      const handle = this.persistence.tracker.writerOf(session.id);
      if (handle !== undefined) {
        handle.enqueueLive(event, (error) => {
          ctx.logger.warn(
            `session-rdb: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`,
          );
        });
        return;
      }
      if (this.failures.has(session.id)) {
        if (!this.dropWarned.has(session.id)) {
          this.dropWarned.add(session.id);
          ctx.logger.warn(
            `session-rdb: dropping events for live session "${session.id}" because persistence failed earlier`,
          );
        }
        return;
      }
      this.buffers.get(session.id)?.push(structuredClone(event));
    });

    ctx.on("session/flush", (session: Session) => {
      const failure = this.failures.get(session.id);
      if (failure !== undefined) return Promise.reject(failure);
      const handle = this.persistence.tracker.writerOf(session.id);
      if (handle === undefined) {
        const ready = this.ready.get(session.id);
        if (ready === undefined) return undefined;
        return ready.then(() => {
          const settled = this.persistence.tracker.writerOf(session.id);
          if (settled === undefined) return undefined;
          return settled.drainLive().then(() => settled.flush());
        });
      }
      return handle.drainLive().then(() => handle.flush());
    });

    ctx.on("session/disposed", (session: Session) => {
      const ready = this.ready.get(session.id);
      this.forget(session.id);
      const closeHandle = (): void => {
        const handle = this.persistence.tracker.writerOf(session.id);
        if (handle === undefined) return;
        handle.close().catch((error: unknown) => {
          ctx.logger.warn(
            `session-rdb: final drain for session "${session.id}" failed: ${String(error)}`,
          );
        });
      };
      if (ready === undefined) {
        closeHandle();
        return;
      }
      void ready.then(closeHandle, closeHandle);
    });

    ctx.effect(
      () => async () => {
        await Promise.allSettled(this.ready.values());
        this.buffers.clear();
        this.ready.clear();
        this.failures.clear();
        this.dropWarned.clear();
        await this.persistence.tracker.closeAll();
        await this.persistence.close();
      },
      `${this.persistence.name} open handles`,
    );
  }

  private watchReady(session: Session, ready: Promise<void>): void {
    void ready.catch((error: unknown) => {
      const failure =
        error instanceof Error
          ? error
          : new Error(
              typeof error === "string"
                ? error
                : `live session "${session.id}" persistence failed`,
            );
      this.failures.set(session.id, failure);
      this.buffers.delete(session.id);
      this.ctx.logger.error(
        `session-rdb: live session "${session.id}" persistence unavailable (${failure.message}); its events will not be persisted`,
      );
    });
  }

  private async ensureHandle(session: Session): Promise<void> {
    const persistence = this.persistence;
    const id = session.header.id;
    if (persistence.tracker.writerOf(id) !== undefined) return;
    await persistence.ready;
    const stored = await persistence.readLog(id, {});
    let handle: LiveHandle;
    if (stored === undefined) {
      handle = (await persistence.create(session.header, {
        inheritedEventCount: session.inheritedEventCount,
      })) as LiveHandle;
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
      assertVersion(stored.meta);

      repairReadView(stored.events);
      const seed = liveEventsOf(session);
      if (!seedCoversPrefix(seed, stored.events)) {
        throw new Error(
          `session "${id}" already has a persisted log on disk that does not match this live session (id collision)`,
        );
      }
      handle = (await persistence.open(id, "write")) as LiveHandle;

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

function seedCoversPrefix(
  seed: readonly SessionEvent[],
  prefix: readonly SessionEvent[],
): boolean {
  return (
    prefix.length <= seed.length &&
    prefix.every((event, index) => {
      const seedEvent = seed[index];
      return seedEvent !== undefined && JSON.stringify(seedEvent) === JSON.stringify(event);
    })
  );
}

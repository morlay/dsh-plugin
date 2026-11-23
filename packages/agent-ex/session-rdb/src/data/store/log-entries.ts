// 日志读写入口：刷盘屏障、原始事件 / 原始导出、整段与增量读取。
//
// 只读后端与读路径（写侧在 write-path.ts）；端口见 ./store-ports.ts。
import {
  SessionId as toSessionId,
  type SessionEvent,
  type SessionHeader,
} from "@morlay/dsh-session/contract";
import {
  SessionPersistenceNotFoundError,
  validateStoredEvents,
} from "@morlay/dsh-session-persistence/contract";
import { SessionStoreError } from "../errors.ts";
import { repairReadView } from "./read-view/index.ts";
import type { StorePorts } from "./store-ports.ts";

/**
 * 日志读写入口：flush 是真屏障；读一律走读路径（格式转换与读视图修复在它里面）。
 * @param deps - 数据面端口。
 * @returns 契约方法（门面逐个转发）。
 */
export function createLogEntries(deps: StorePorts) {
  return {
    async flush(): Promise<void> {
      const failures = await deps.drainLiveWrites();
      if (failures.length === 0) return;
      // 每个会话的失败原样留在 cause 的 AggregateError 里：域码只回答 flush 没做成，
      // 哪几条会话、各自为什么在那里（失败态会话是其中之一）。
      throw new SessionStoreError(
        "SESSION_FLUSH_FAILED",
        "session-rdb: flush failed for " + String(failures.length) + " writer(s)",
        { cause: new AggregateError(failures, "session-rdb: flush failed") },
      );
    },

    async readRawEvents(
      id: string,
      signal?: AbortSignal,
    ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
      const sessionId = toSessionId(id);
      const log = await deps.readPath().readLog(sessionId, {}, signal);
      if (log === undefined) throw new SessionPersistenceNotFoundError(sessionId);
      return { meta: log.meta, events: log.events };
    },

    async readRaw(
      id: string,
      signal?: AbortSignal,
    ): Promise<{ inheritedEventCount: number; filename: string; content: string } | undefined> {
      return await deps.readPath().readRaw(toSessionId(id), signal);
    },

    async load(
      id: string,
      signal?: AbortSignal,
    ): Promise<{
      meta: SessionHeader;
      inheritedEventCount: number;
      events: readonly SessionEvent[];
    }> {
      const sessionId = toSessionId(id);
      signal?.throwIfAborted();
      await deps.ready();
      signal?.throwIfAborted();
      const log = await deps.readPath().readLog(sessionId, {}, signal);
      if (log === undefined) {
        // 未落库的 live 会话没有磁盘视图：与 handle.read 的 detached 口径一致，返回空日志。
        const pending = deps.tracker.pendingOf(sessionId);
        if (pending === undefined) throw new SessionPersistenceNotFoundError(sessionId);
        return {
          meta: pending.header,
          inheritedEventCount: pending.inheritedEventCount,
          events: [],
        };
      }
      repairReadView(log.events);
      validateStoredEvents(log.meta, log.events);
      return {
        meta: log.meta,
        inheritedEventCount: log.inheritedEventCount,
        events: log.events,
      };
    },

    async readFrom(
      id: string,
      fromSeq: number,
      signal?: AbortSignal,
    ): Promise<{
      meta: SessionHeader;
      inheritedEventCount: number;
      events: readonly SessionEvent[];
    }> {
      const sessionId = toSessionId(id);
      const log = await deps.readPath().readLog(sessionId, { fromSeq }, signal);
      if (log === undefined) throw new SessionPersistenceNotFoundError(sessionId);
      return {
        meta: log.meta,
        inheritedEventCount: log.inheritedEventCount,
        events: log.events,
      };
    },
  };
}

// 句柄面需要的宿主端口：会话日志的读写入口 + tracker 与位点守卫。
//
// 单独立一个接口是为了断开 `handles ↔ rdb-store` 的运行时环（句柄只依赖这个面，不依赖服务类）。
import type { SessionLogOffset } from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionHeader, SessionId } from "@morlay/dsh-session/contract";
import type { RdbBackendTracker } from "./handles.ts";
import type { BranchLog } from "./branch/port.ts";

export type RdbLogView = BranchLog;

export interface RdbStoreHost {
  readonly tracker: RdbBackendTracker;

  readLog(
    id: SessionId,
    options?: { fromSeq?: number },
    signal?: AbortSignal,
  ): Promise<RdbLogView | undefined>;

  materializeEmpty(meta: SessionHeader, inheritedEventCount: SessionLogOffset): Promise<void>;

  appendBatch(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
    tornTruncateTo?: number,
  ): Promise<boolean>;
}

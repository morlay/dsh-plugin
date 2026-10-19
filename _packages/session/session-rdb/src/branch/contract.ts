import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionPersistenceSnapshot } from "@deepseek-ai/dsh-session-persistence";
import { Injectable } from "@morlay/zephyr";
import type { BranchBoundary, ForkFromOptions } from "./types.ts";

export type { BranchBoundary, ForkFromOptions } from "./types.ts";

export type BranchAnchorMode = "after" | "before";

// 唯一契约：实现层 `extends` 它（纯类可 new，Service 可 implements）；`@Injectable()` 让它同时是注入令牌，
// 服务注册由实现层完成（`super(ctx, …)` 是运行期动态的），消费方只 `inject(SessionBranchProvider)`。
@Injectable()
export abstract class SessionBranchProvider {
  abstract readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode?: BranchAnchorMode,
    signal?: AbortSignal,
  ): Promise<BranchBoundary>;

  abstract forkFrom(
    sourceId: SessionId,
    options?: ForkFromOptions,
    signal?: AbortSignal,
  ): Promise<SessionId>;

  abstract rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot>;
}

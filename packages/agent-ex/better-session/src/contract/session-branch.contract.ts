// 分支面的契约：数据层分支原语（读前缀 / 派生 / 回退）。
//
// 实现方是 RDB 后端（`server/rdb/branch/index.ts`）；消费方（编辑编排）只认这一个端口。
import type { SessionEvent, SessionHeader, SessionId } from "@morlay/dsh-session/contract";
import type { SessionPersistenceSnapshot } from "@morlay/dsh-session-persistence/contract";
import { Injectable } from "@morlay/zephyr";
import type { BranchAnchorMode, BranchBoundary, ForkFromOptions } from "../endpoint/branch.ts";

@Injectable({ name: "sessionBranch" })
export abstract class SessionBranch {
  // 定位 `atSeq` 锚定的闭合 `turn/end` 边界并返回前缀；`after` 含目标轮（fork），`before` 排除目标轮（编辑 / 重试）。
  abstract readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode?: BranchAnchorMode,
    signal?: AbortSignal,
  ): Promise<BranchBoundary>;

  // 读整段日志（撤回边界只能在存储坐标上算，编辑编排恒读这一份）。
  abstract readRawEvents(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>;

  // 纯 append 派生新会话（父会话不动）。
  abstract forkFrom(
    sourceId: SessionId,
    options?: ForkFromOptions,
    signal?: AbortSignal,
  ): Promise<SessionId>;

  // 唯一的显式回退原语。
  abstract rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot>;
}

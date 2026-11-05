// 分支面的**两端共用声明**：锚定模式、派生参数、边界与错误。
//
// 住 `./endpoint` 而不是包根：浏览器半（`./ui`）也要这些值，而包根聚合了宿主实现。
import type { SessionEvent, SessionId } from "@morlay/dsh-session/contract";

// `session-branch/version` 的形状版本：只用于识别既有日志里已落库的该事件，本包不产出它。
export const SESSION_BRANCH_VERSION_SCHEMA = 1;

export type CascadePolicy = "truncate" | "preserve";

export type VersionOperation = "edit" | "reroll" | "retry" | "fork" | "rewind";

export type EditableBlockKind = "user" | "assistant.reasoning" | "assistant.response";

// 锚定语义：`after` 含目标轮（fork），`before` 排除目标轮（编辑 / 重掷 / 重试）。
export type BranchAnchorMode = "after" | "before";

export interface BranchBoundary {
  seq: number;
  events: readonly SessionEvent[];
}

export interface BranchForkMeta {
  cwd?: string;
  createdAt?: number;
  agentPreset?: string;
  origin?: "subagent";
  delegationDepth?: number;
}

export interface ForkFromOptions {
  atSeq?: number;
  anchorMode?: BranchAnchorMode;
  seedSuffix?: readonly SessionEvent[];
  childSessionId?: SessionId;
  meta?: BranchForkMeta;
}

export type SessionBranchErrorCode =
  | "SESSION_NOT_FOUND"
  | "INVALID_BOUNDARY"
  | "OPEN_TURN"
  | "FORK_UNAVAILABLE"
  | "REWIND_CONFLICT";

export class SessionBranchError extends Error {
  readonly code: SessionBranchErrorCode;

  constructor(message: string, code: SessionBranchErrorCode) {
    super(message);
    this.name = "SessionBranchError";
    this.code = code;
  }
}

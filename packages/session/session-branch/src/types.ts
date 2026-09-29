import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session";

// `session-branch/version` 的形状定义：只用于识别既有日志里已落库的该事件，本仓库不产出它、读侧也不参与投影
// （见 ADR-删除版本树投影并停止写版本效果）。
export const SESSION_BRANCH_VERSION_SCHEMA = 1;

export type CascadePolicy = "truncate" | "preserve";

export type VersionOperation = "edit" | "reroll" | "retry" | "fork" | "rewind";

export type EditableBlockKind = "user" | "assistant.reasoning" | "assistant.response";

export interface SessionBranchEffect {
  id: string;
  operation: VersionOperation;
  cascade: CascadePolicy;

  targetTurn: number;

  targetEventSeq: number;
  targetBlockIndex?: number;
  blockKind?: EditableBlockKind;

  before?: string;

  after?: string;
}

export interface SessionBranchInverse {
  kind: "restore-version";
  sessionId: SessionId;
}

export interface SessionBranchVersionEvent {
  schemaVersion: typeof SESSION_BRANCH_VERSION_SCHEMA;
  effect: SessionBranchEffect;
  inverse: SessionBranchInverse;
}

declare module "@deepseek-ai/dsh-session" {
  interface SessionEventMap {
    "session-branch/version": SessionBranchVersionEvent;
  }
}

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

  anchorMode?: import("./provider.ts").BranchAnchorMode;

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

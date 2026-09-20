import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session";

// `session-branch/version` 的**历史形状**：写侧（就地编辑产出）与读侧（版本树投影）都已删除
// （见 ADR 版本效果停止落库 / 版本树投影删除）。这里的定义只用于识别旧数据里已落库的
// ignorable 事件，不再有新事件产生、也没有读者。
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

export interface SessionBranchVersionEventEnvelope {
  type: "session-branch/version";
  seq: number;
  time: number;
  ignorable?: true;
  data: SessionBranchVersionEvent;
}

export function isSessionBranchVersionEvent(
  event: SessionEvent | { type: string; data: unknown },
): event is SessionBranchVersionEventEnvelope {
  return (
    event.type === "session-branch/version" &&
    (event.data as { schemaVersion?: unknown }).schemaVersion === SESSION_BRANCH_VERSION_SCHEMA
  );
}

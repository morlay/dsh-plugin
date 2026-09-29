import type { SessionId } from "@deepseek-ai/dsh-session";
import type { CascadePolicy } from "@morlay/session-branch";

// 会话编辑面的六条 POST 路径：一条动作一条路径（路径定动作，body 只带该动作的参数）。
// 与上游官方路由分开的理由见 ADR-管理面HTTP路由前缀与上游分家。
export const SESSION_EDITOR_PATHS = {
  edit: "/api/morlay/v1/session/edit",
  reroll: "/api/morlay/v1/session/reroll",
  retry: "/api/morlay/v1/session/retry",
  rewind: "/api/morlay/v1/session/rewind",
  recall: "/api/morlay/v1/session/recall",
  fork: "/api/morlay/v1/session/fork",
} as const;

export type SessionEditorAction = keyof typeof SESSION_EDITOR_PATHS;

export type { VersionOperation } from "@morlay/session-branch";

export interface EditOperation {
  action: "edit";
  sessionId: SessionId;
  eventSeq: number;
  blockIndex: number;
  text: string;
  cascade: CascadePolicy;
}

export interface RerollOperation {
  action: "reroll";
  sessionId: SessionId;
}

export interface RetryOperation {
  action: "retry";
  sessionId: SessionId;
  turn: number;
  cascade: CascadePolicy;
}

export interface RewindOperation {
  action: "rewind";
  sessionId: SessionId;
  toBoundary: number;
}

export interface RecallOperation {
  action: "recall";
  sessionId: SessionId;
  eventSeq: number;
}

export interface ForkOperation {
  action: "fork";
  sessionId: SessionId;
  atSeq?: number;
  childSessionId?: SessionId;
}

export type SessionEditorOperation =
  | EditOperation
  | RerollOperation
  | RetryOperation
  | RewindOperation
  | RecallOperation
  | ForkOperation;

export interface SessionEditorOperationResult {
  sessionId: SessionId;
  queuedTurns: number;

  live?: boolean;
}

export interface EditableMessageBlock {
  key: string;

  turn?: number;
  eventSeq: number;
  blockIndex: number;
  kind: "user" | "assistant.reasoning" | "assistant.response";
  text: string;
  time: number;
}

export interface RetryableTurn {
  turn: number;
  userEventSeq: number;
  preview: string;
  time: number;
}

// 编辑编排的契约：六条动作（编辑 / 重掷 / 重试 / 撤回 / 分叉 / 回退）的语义在这里，日志怎么改在实现里。
import { Injectable } from "@morlay/zephyr";
import type { BranchBoundary } from "../endpoint/branch.ts";
import type {
  SessionEditRequest,
  SessionEditorValue,
  SessionRecallRequest,
  SessionRerollRequest,
  SessionRetryRequest,
} from "../endpoint/session-editor-endpoint.ts";

@Injectable({ name: "sessionEditor" })
export abstract class SessionEditor {
  abstract readBranchPrefix(
    id: string,
    atSeq?: number,
    mode?: "after" | "before",
    signal?: AbortSignal,
  ): Promise<BranchBoundary>;

  abstract fork(
    sourceId: string,
    atSeq?: number,
    childSessionId?: string,
    meta?: { cwd?: string; agentPreset?: string },
    signal?: AbortSignal,
  ): Promise<string>;

  abstract rewind(id: string, toBoundary: number, signal?: AbortSignal): Promise<void>;

  abstract edit(request: SessionEditRequest, signal?: AbortSignal): Promise<SessionEditorValue>;

  abstract reroll(request: SessionRerollRequest, signal?: AbortSignal): Promise<SessionEditorValue>;

  abstract retry(request: SessionRetryRequest, signal?: AbortSignal): Promise<SessionEditorValue>;

  abstract recall(request: SessionRecallRequest, signal?: AbortSignal): Promise<SessionEditorValue>;
}

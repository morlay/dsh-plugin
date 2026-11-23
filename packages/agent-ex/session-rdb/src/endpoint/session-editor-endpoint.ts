// `sessionEditor` 这一组的**跨端契约**：组名、组内方法名与请求/响应形状。
//
// 两端共用同一份声明：宿主侧实现它（`server/endpoint/`），浏览器侧按它消费（`ui/` 的 remote 实现）。
// 契约是普通类，不继承 `RemoteClientBase`——那个基类带 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有。
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/client/remote";
import type { CascadePolicy } from "./branch.ts";

// 可编辑的一条消息块（消息渲染面按它展示编辑入口）。
export interface EditableMessageBlock {
  readonly key: string;
  readonly turn?: number;
  readonly eventSeq: number;
  readonly blockIndex: number;
  readonly kind: "user" | "assistant.reasoning" | "assistant.response";
  readonly text: string;
  readonly time: number;
}

// 可重试的一个已落定回合。
export interface RetryableTurn {
  readonly turn: number;
  readonly userEventSeq: number;
  readonly preview: string;
  readonly time: number;
}

// 一次编辑动作的结果：目标会话、本次排队的用户输入条数与是否有活跃会话。
export interface SessionEditorValue {
  readonly sessionId: string;
  readonly queuedTurns: number;
  readonly live?: boolean;
}

export interface SessionEditRequest {
  readonly sessionId: string;
  readonly eventSeq: number;
  readonly blockIndex: number;
  readonly text: string;
  readonly cascade: CascadePolicy;
}

export interface SessionRerollRequest {
  readonly sessionId: string;
}

export interface SessionRetryRequest {
  readonly sessionId: string;
  readonly turn: number;
  readonly cascade: CascadePolicy;
}

export interface SessionRewindRequest {
  readonly sessionId: string;
  readonly toBoundary: number;
}

export interface SessionRecallRequest {
  readonly sessionId: string;
  readonly eventSeq: number;
}

export interface SessionForkRequest {
  readonly sessionId: string;
  readonly atSeq?: number;
  readonly childSessionId?: string;
}

// 六条动作一条方法一条：动作由方法名定，请求里不再带 `action` 字段。
@RemoteGroup({ name: "sessionEditor" })
export class SessionEditorEndpoint {
  @RemoteMethod()
  async edit(_request: SessionEditRequest): Promise<RemoteResultWire<SessionEditorValue>> {
    throw new Error("sessionEditor/edit：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async reroll(_request: SessionRerollRequest): Promise<RemoteResultWire<SessionEditorValue>> {
    throw new Error("sessionEditor/reroll：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async retry(_request: SessionRetryRequest): Promise<RemoteResultWire<SessionEditorValue>> {
    throw new Error("sessionEditor/retry：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async rewind(_request: SessionRewindRequest): Promise<RemoteResultWire<SessionEditorValue>> {
    throw new Error("sessionEditor/rewind：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async recall(_request: SessionRecallRequest): Promise<RemoteResultWire<SessionEditorValue>> {
    throw new Error("sessionEditor/recall：契约类未实现（宿主侧要在子类里实现它）");
  }

  @RemoteMethod()
  async fork(_request: SessionForkRequest): Promise<RemoteResultWire<SessionEditorValue>> {
    throw new Error("sessionEditor/fork：契约类未实现（宿主侧要在子类里实现它）");
  }
}

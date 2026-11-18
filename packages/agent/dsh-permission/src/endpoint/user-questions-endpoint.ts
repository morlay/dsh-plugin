// `userQuestions` 这一组的**跨端契约**（与上游 descriptor 同形）。
//
// 上游 `interaction/user-questions` 的 wire 面只有两条：
//   `userQuestions/answer`      unary，参数依次是 `agent` / `callId` / `answer`，返回 `RemoteResult<boolean>`
//   `userQuestions/attachWait`  **stream**，参数 `agent` / `callId`，逐帧给 `{ remainingMs }`
// 依据：`vendor/deepseek-harness/packages/interaction/user-questions/lib/typert.remote-client.ts:40-140`。
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions/types";
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/remote";

/** `userQuestions/answer` 的命名参数（键名照上游 descriptor 的 `parameters[].name`）。 */
export interface UserQuestionsAnswerRequest {
  /** 会话身份（descriptor 的 `agent` 参数，wire 名 `agentId`）。 */
  readonly agent: string;
  /** 待答问题对应的工具调用。 */
  readonly callId: string;
  /** 完整作答批次（每题一条）。 */
  readonly answer: AskUserQuestionAnswer;
}

/** `userQuestions/attachWait` 的命名参数。 */
export interface UserQuestionsAttachWaitRequest {
  /** 会话身份（descriptor 的 `agent` 参数）。 */
  readonly agent: string;
  /** 前台等待对应的工具调用。 */
  readonly callId: string;
}

/**
 * `userQuestions` 组：作答与「挂到前台等待」两条。
 *
 * 两条的 wire 名（`userQuestions/answer` / `userQuestions/attachWait`）都在这里：组名在
 * `@RemoteGroup` 上，方法名就是方法名。宿主侧 `registerRemoteGroup` 一次注册两条——
 * `mode: "stream"` 的那条自动走 `registerStream`，不再有手写的端点名常量。
 */
@RemoteGroup({ name: "userQuestions" })
export class UserQuestionsEndpoint {
  /**
   * 作答一批已经问出的问题。
   * @param request - 会话、工具调用与作答批次。
   * @returns 该问题是否仍处于可作答状态；失败用 `{ ok: false }` 带原因。
   */
  @RemoteMethod()
  async answer(_request: UserQuestionsAnswerRequest): Promise<RemoteResultWire<boolean>> {
    throw new Error("userQuestions/answer：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 挂到一条前台提问的等待上：逐帧给剩余毫秒，直到这次提问结束或被取消。
   * @param _request - 会话身份与工具调用。
   * @param _signal - wire 的取消信号（流承载关闭时 abort）。
   * @returns 逐帧的 `{ remainingMs }`。
   */
  @RemoteMethod({ mode: "stream" })
  attachWait(
    _request: UserQuestionsAttachWaitRequest,
    _signal: AbortSignal,
  ): AsyncIterable<{ remainingMs: number }> {
    throw new Error("userQuestions/attachWait：契约类未实现（宿主侧要在子类里实现它）");
  }
}

// `userQuestions` 这一组的**跨端契约**（与上游 descriptor 同形）。
//
// 上游 `interaction/user-questions` 的 wire 面只有两条：
//   `userQuestions/answer`      unary，参数依次是 `agent` / `callId` / `answer`，返回 `RemoteResult<boolean>`
//   `userQuestions/attachWait`  **stream**，参数 `agent` / `callId`，逐帧给 `{ remainingMs }`
// 依据：`vendor/deepseek-harness/packages/interaction/user-questions/lib/typert.remote-client.ts:40-140`。
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions/types";
import { RemoteGroup, RemoteMethod, type RemoteResultWire } from "@morlay/zephyr-app/remote";

/**
 * 流式端点名：`attachWait` 逐帧回 `{ remainingMs }`，不在 `registerRemoteGroup` 的 unary 表里，
 * 由宿主侧 `RemoteHandlers.registerStream` 单独注册。
 *
 * 这里是它**唯一**的 home，而它仍是手写字符串：这条流式方法没有在契约类上声明
 * （`@RemoteMethod({ mode: "stream" })` 会被 `registerRemoteGroup` 当成要注册的方法，
 * 与 `server/user-questions-endpoint.service.ts` 那处 `registerStream` 撞成「已经注册过」）。
 * 等那条注册点改成 `@Remote()` 装饰（另一票）时，这个常量随它一起删。
 */
export const USER_QUESTIONS_ATTACH_WAIT_ENDPOINT = "userQuestions/attachWait";

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

/** `userQuestions` 组：作答与「挂到前台等待」两条。 */
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
}

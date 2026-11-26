// `userQuestions` 这一组的跨端契约：组名、方法名，与 wire 的形参 / 应答类型。
//
// 上游真源：`vendor/deepseek-harness/packages/interaction/user-questions/src/index.ts:79`
// （`UserQuestionService`）：`answer(agent, callId, answer): boolean`、`attachWait(agent, callId, signal)`（流）。
// wire 形参名见 `lib/typert.host.ts`：`answer` 是 `agentId` / `callId` / `answer`，`attachWait` 是 `agentId` / `callId`
// ——**位置参数**。曾经这里是一个 `{ request }` 对象，网关按上游 descriptor 校验，必然 `arguments-invalid`
// （与 `terminal/environment`、`commands/execute` 同一类）。
//
// 应答是**裸值**（`RemoteResult` 由桥与客户端面各包一层）。
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions/types";
import type { UserQuestionService as UserQuestionsHost } from "@deepseek-ai/dsh-user-questions";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam, MapParam } from "@morlay/zephyr-app/typert";
import type { Agent } from "@morlay/dsh-agent";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { RemoteGroup, RemoteMethod, groupNameOf } from "@morlay/zephyr-app/remote";

/** `callId` 的类型（上游 `answer` 的第二个形参，`ToolCallId`）。 */
export type UserQuestionsCallId = Parameters<UserQuestionsHost["answer"]>[1];

/**
 * 组名（`userQuestions`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function userQuestionsGroupName(): string {
  return groupNameOf(UserQuestionsEndpoint);
}

/** `userQuestions` 组：作答一条前台提问、挂到它的等待上。 */
@RemoteGroup({ name: "userQuestions" })
export class UserQuestionsEndpoint {
  /**
   * 作答一条已经问出的问题。
   * @param _agentId - 会话身份（lookup `agent` 的 wire 形态）。
   * @param _callId - 待答问题对应的工具调用。
   * @param _answer - 完整作答批次（每题一条）。
   * @returns 该问题是否仍处于可作答状态。
   */
  @RemoteMethod({ parameters: ["agentId", "callId", "answer"] })
  async answer(
    _agentId: SessionId,
    _callId: UserQuestionsCallId,
    _answer: AskUserQuestionAnswer,
  ): Promise<boolean> {
    throw new Error("userQuestions/answer：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 挂到一条前台提问的等待上：逐帧给剩余毫秒，直到这次提问结束或被取消。
   * @param _agentId - 会话身份。
   * @param _callId - 前台等待对应的工具调用。
   * @param _signal - 宿主侧的取消通道（载具注入，不是 wire 参数）。
   * @returns 逐帧的 `{ remainingMs }`。
   */
  @RemoteMethod({ mode: "stream", parameters: ["agentId", "callId"] })
  attachWait(
    _agentId: SessionId,
    _callId: UserQuestionsCallId,
    _signal: AbortSignal,
  ): AsyncIterable<{ remainingMs: number }> {
    throw new Error("userQuestions/attachWait：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/** 上游 `userQuestions` 的 wire 面：去末尾 signal → lookup 把 `Agent` 换成 id → 异步化（流不包 Promise）。 */
type UserQuestionsWire = AsyncReturn<
  MapParam<DropParam<UserQuestionsHost, AbortSignal>, Agent, SessionId>
>;

export type UserQuestionsEndpointCovered = AssertTrue<
  AssertWireFace<Pick<UserQuestionsWire, "answer">, Pick<UserQuestionsEndpoint, "answer">>
>;

/** 流式那条：契约侧也要把末尾取消信号摘掉再比（载具注入，不是 wire 参数）。 */
export type UserQuestionsStreamCovered = AssertTrue<
  AssertWireFace<
    Pick<UserQuestionsWire, "attachWait">,
    Pick<DropParam<UserQuestionsEndpoint, AbortSignal>, "attachWait">
  >
>;

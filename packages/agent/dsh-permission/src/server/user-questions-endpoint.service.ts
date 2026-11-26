// `userQuestions` 组的**宿主侧实现**：转发到上游 `UserQuestionService` 的那条真队列。
//
// 两条方法的语义都在上游服务里（`answer` 往 agent 的下一轮 steer 一条 reply；`attachWait` 把
// 一条前台等待挂到调用方的流上），这里只做 agent 解析与品牌转换；应答是**裸值**（不再包 `RemoteResult`）。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`）：`attachWait` 在契约上是
// `mode: "stream"`，`registerRemoteGroup` 自己走 `registerStream`——这里不再有第二处注册点。
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions/types";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentDirectory } from "@morlay/dsh-agent";
import { inject, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { UserQuestionQueue } from "../contract/user-question-queue.contract.ts";
import { UserQuestionsEndpoint, type UserQuestionsCallId } from "../endpoint/user-questions-endpoint.ts";
/** `userQuestions` 组的宿主实现。 */
@RemoteGroup()
export class UserQuestionsEndpointDefault
  extends UserQuestionsEndpoint
  implements OnInit, OnDispose
{
  private readonly handlers = inject(RemoteHandlers);

  private readonly questions = inject(UserQuestionQueue);

  private readonly agents = inject(AgentDirectory);

  private stop = (): void => {};

  onInit(): void {
    this.stop = registerRemoteGroup(this.handlers, this);
  }

  onDispose(): void {
    this.stop();
  }

  override async answer(
    agentId: SessionId,
    callId: UserQuestionsCallId,
    answer: AskUserQuestionAnswer,
  ): Promise<boolean> {
    const agent = this.agentOf(agentId);
    if (agent === undefined) {
      throw new Error(`userQuestions/answer: session "${String(agentId)}" has no live agent`);
    }
    return this.questions.answer(agent, callId, answer);
  }

  /**
   * 挂到一条前台等待上（流式）。
   * @param agentId - 会话身份（wire 名 `agentId`）。
   * @param callId - 前台等待对应的工具调用（wire 名 `callId`）。
   * @param signal - 宿主侧取消通道（载具注入）。
   * @returns 逐帧的剩余毫秒数。
   */
  override attachWait(
    agentId: SessionId,
    callId: UserQuestionsCallId,
    signal: AbortSignal,
  ): AsyncIterable<{ remainingMs: number }> {
    const agent = this.agentOf(agentId);
    if (agent === undefined) {
      throw new Error(`userQuestions/attachWait: session "${String(agentId)}" has no live agent`);
    }
    return this.questions.attachWait(agent, callId, signal);
  }

  private agentOf(sessionId: string) {
    return this.agents.get(SessionId(sessionId));
  }
}
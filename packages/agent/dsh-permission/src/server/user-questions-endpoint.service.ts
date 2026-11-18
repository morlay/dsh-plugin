// `userQuestions` 组的**宿主侧实现**：转发到上游 `UserQuestionService` 的那条真队列。
//
// 两条方法的语义都在上游服务里（`answer` 往 agent 的下一轮 steer 一条 reply；`attachWait` 把
// 一条前台等待挂到调用方的流上），这里只做 agent 解析、品牌转换与 `RemoteResult` 包装。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`）：`attachWait` 在契约上是
// `mode: "stream"`，`registerRemoteGroup` 自己走 `registerStream`——这里不再有第二处注册点。
import { SessionId } from "@morlay/dsh-session/endpoint";
import { ToolCallId } from "@morlay/dsh-agent/server";
import { AgentDirectory } from "@morlay/dsh-agent";
import { inject, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import {
  asRemoteResult,
  RemoteGroup,
  registerRemoteGroup,
  type RemoteResultWire,
} from "@morlay/zephyr-app/remote";
import { UserQuestionQueue } from "../contract/user-question-queue.contract.ts";
import {
  UserQuestionsEndpoint,
  type UserQuestionsAnswerRequest,
  type UserQuestionsAttachWaitRequest,
} from "../endpoint/user-questions-endpoint.ts";

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

  override async answer(request: UserQuestionsAnswerRequest): Promise<RemoteResultWire<boolean>> {
    return await asRemoteResult(async () => {
      const agent = this.agentOf(request.agent);
      if (agent === undefined) {
        throw new Error(`userQuestions/answer: session "${request.agent}" has no live agent`);
      }
      return this.questions.answer(agent, ToolCallId(request.callId), request.answer);
    });
  }

  /**
   * 挂到一条前台等待上（流式）。
   * @param request - wire 的命名参数（`agent` / `callId`）。
   * @param signal - wire 的取消信号。
   * @returns 逐帧的剩余毫秒数。
   */
  override attachWait(
    request: UserQuestionsAttachWaitRequest,
    signal: AbortSignal,
  ): AsyncIterable<{ remainingMs: number }> {
    const agent = this.agentOf(request.agent);
    if (agent === undefined) {
      throw new Error(`userQuestions/attachWait: session "${request.agent}" has no live agent`);
    }
    return this.questions.attachWait(agent, ToolCallId(request.callId), signal);
  }

  private agentOf(sessionId: string) {
    return this.agents.get(SessionId(sessionId));
  }
}

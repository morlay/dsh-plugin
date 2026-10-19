// `userQuestions` 组的**宿主侧实现**：转发到上游 `UserQuestionService` 的那条真队列。
//
// 两条方法的语义都在上游服务里（`answer` 往 agent 的下一轮 steer 一条 reply；`attachWait` 把
// 一条前台等待挂到调用方的流上），这里只做 agent 解析、品牌转换与 `RemoteResult` 包装。
import { SessionId } from "@morlay/dsh-session/endpoint";
import { ToolCallId } from "@morlay/dsh-agent/server";
import { AgentDirectory } from "@morlay/dsh-agent";
import { inject, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { asRemoteResult, RemoteGroup, registerRemoteGroup, type RemoteResultWire } from "@morlay/zephyr-app/remote";
import { UserQuestionQueue } from "../contract/user-question-queue.contract.ts";
import {
  USER_QUESTIONS_ATTACH_WAIT_ENDPOINT,
  UserQuestionsEndpoint,
  type UserQuestionsAnswerRequest,
} from "../endpoint/user-questions-endpoint.ts";

/** `userQuestions` 组的宿主实现。 */
@RemoteGroup()
export class UserQuestionsEndpointDefault extends UserQuestionsEndpoint implements OnInit, OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  private readonly questions = inject(UserQuestionQueue);

  private readonly agents = inject(AgentDirectory);

  private stop = (): void => {};

  onInit(): void {
    const stopAnswer = registerRemoteGroup(this.handlers, this);
    const stopWait = registerWaitStream(this.handlers, (sessionId, callId, signal) => {
      const agent = this.agentOf(sessionId);
      if (agent === undefined) throw new Error(`userQuestions/attachWait: session "${sessionId}" has no live agent`);
      return this.questions.attachWait(agent, ToolCallId(callId), signal);
    });
    this.stop = () => {
      stopAnswer();
      stopWait();
    };
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

  private agentOf(sessionId: string) {
    return this.agents.get(SessionId(sessionId));
  }
}

/**
 * 注册 `userQuestions/attachWait` 这条**流式**端点。
 *
 * 流式方法不在 `registerRemoteGroup` 的 unary 表里（那个只认返回一个最终值的方法），所以单独走
 * `RemoteHandlers.registerStream`；wire 端点名仍只在契约里写一次。
 * @param handlers - 宿主侧 handler 表。
 * @param open - 参数（`agent` / `callId`）与取消信号 → 帧序列。
 * @returns 撤销注册的函数。
 */
function registerWaitStream(
  handlers: RemoteHandlers,
  open: (sessionId: string, callId: string, signal: AbortSignal) => AsyncIterable<{ remainingMs: number }>,
): () => void {
  return handlers.registerStream(USER_QUESTIONS_ATTACH_WAIT_ENDPOINT, (args, signal) => {
    const sessionId = args["agent"];
    const callId = args["callId"];
    if (typeof sessionId !== "string" || typeof callId !== "string") {
      throw new Error("userQuestions/attachWait: 缺少 agent 或 callId");
    }
    return open(sessionId, callId, signal);
  });
}

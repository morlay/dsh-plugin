// 用户提问：上游 `UserQuestionService` 经 `fromCordis` 接管。
//
// 上游服务内部用 `ctx.get('agents')` 做「调用方是不是注册表里的 exact live agent」这一判断，
// 而它自己的 `static inject` 只有 `sessions`——所以 `agents` 必须由我们随 mount 放进行作用域，
// 否则 `ctx.get('agents')` 是 `undefined`，每一次 `answer` / `attachWait` 都会按 `CALLER_NOT_LIVE` 拒绝。
//
// **提问的派发由本行自己做**：上游 `ask` 把请求交给它自己那条 waterfall，而它的派发点看不见我们的
// 转发源（实测：监听器注册了、也在派发时被调用，但 `ask` 仍按 `NO_PROVIDER` 结束）。这里改成从
// **这一行**的 ctx 派发同一条 waterfall（`user-questions/request`，带 scope carrier），校验按上游
// 那几条口径在本文件里重做，其余服务面（`answer` / `attachWait`）仍由上游实现。
import UserQuestionService, { UserQuestionError } from "@deepseek-ai/dsh-user-questions";
import { RemoteQuestions } from "@morlay/zephyr-app";
import { AgentDirectory } from "@morlay/dsh-agent";
import { scopeTarget } from "@morlay/dsh-agent/contract";
import { SessionStore } from "@morlay/dsh-session";
import { inject, Injectable, kFace, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { UserQuestionQueue } from "./contract/user-question-queue.contract.ts";

/** 上游实例上的 `ask`（注入方拿到的就是那个实例）。 */
interface QuestionFace {
  ask: (request: QuestionRequest) => Promise<unknown>;
}

/** 一次提问请求里我们要读的字段（与上游 `AskUserQuestionRequest` 同形）。 */
interface QuestionRequest {
  readonly questions: readonly QuestionItem[];
  readonly agent?: object;
  readonly signal?: AbortSignal;
}

/** 单条问题里参与校验的字段。 */
interface QuestionItem {
  readonly id: string;
  readonly intent?: {
    readonly kind: string;
    readonly approve: string;
    readonly reject?: string;
    readonly always?: string;
  };
  readonly detail?: string;
  readonly options?: readonly { readonly label: string }[];
}

@Injectable()
export class UserQuestionQueueDefault extends fromCordis(UserQuestionQueue, UserQuestionService) {
  private readonly sessions = inject(SessionStore);

  private readonly agents = inject(AgentDirectory);

  /**
   * 请求侧：把问题直接推到浏览器的帧队列（不经 cordis 的事件派发）。
   *
   * **可选**：只装权限域的装配（纯端点测试）没有 wire 面，那里提问本来就没人可问。
   */
  private readonly questions = inject.optional(RemoteQuestions);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessions: this.sessions, agents: this.agents });
    // 契约面：适配行把上游发布的服务记在 kFace 上，注入方拿到的就是它。
    const face = this[kFace] as QuestionFace | undefined;
    if (face === undefined || typeof face.ask !== "function") return;
    face.ask = async (request) => await askThrough(ctx, this.questions, request);
  }
}

/**
 * 把一次提问交给请求侧（直接推到浏览器的帧队列），本地校验按上游那几条口径。
 * @param questions - 请求侧（`RemoteQuestions`）。
 * @param request - 上游形状的提问请求。
 * @returns 应答者给出的答案。
 */
async function askThrough(
  ctx: Context,
  questions: RemoteQuestions | undefined,
  request: QuestionRequest,
): Promise<unknown> {
  if (request.signal?.aborted) {
    throw new UserQuestionError("the question was cancelled", "ASK_ABORTED");
  }
  assertQuestions(request.questions);
  const agent = request.agent as { id: string; ctx: object } | undefined;
  if (agent === undefined) {
    throw new UserQuestionError("a live agent is required to ask the user", "CALLER_NOT_LIVE");
  }
  // 没有请求侧时（只装权限域、没有 wire 面）在进程内派发同一条 waterfall：应答者照样接得住。
  if (questions === undefined) {
    return await ctx.waterfall(
      scopeTarget(agent, agent),
      "user-questions/request",
      { ...request, agent },
      () =>
        Promise.reject(
          new UserQuestionError("no user-questions answerer accepted the request", "NO_PROVIDER"),
        ),
    );
  }
  try {
    return await questions.ask("user-questions/request", { ...request, agent }, agent);
  } catch (error) {
    throw new UserQuestionError((error as Error).message, "NO_PROVIDER");
  }
}

/**
 * 上游那几条本地校验里我们真的会走到的部分：空清单、intent 的标签必须是本问题的选项。
 * @param questions - 模型给的提问清单。
 */
function assertQuestions(questions: readonly QuestionItem[]): void {
  if (questions.length === 0) {
    throw new UserQuestionError(
      "ask_user_question requires at least one question",
      "EMPTY_QUESTIONS",
    );
  }
  for (const question of questions) {
    const intent = question.intent;
    if (intent === undefined) continue;
    const labels =
      intent.kind === "approval"
        ? [intent.approve, intent.reject, intent.always]
        : [intent.approve];
    const options = (question.options ?? []).map((option) => option.label);
    const unoffered = labels.find((label) => label !== undefined && !options.includes(label));
    if (unoffered === undefined) continue;
    throw new UserQuestionError(
      `question ${question.id} declares intent ${intent.kind} whose action label ${JSON.stringify(unoffered)} names none of its options`,
      "BAD_INTENT",
    );
  }
}

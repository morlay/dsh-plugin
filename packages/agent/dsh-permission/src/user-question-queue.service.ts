// 用户提问：上游 `UserQuestionService` 经 `fromCordis` 接管。
//
// 上游服务内部用 `ctx.get('agents')` 做「调用方是不是注册表里的 exact live agent」这一判断
// （`vendor/.../interaction/user-questions/src/index.ts:137-141`），而它自己的 `static inject` 只有
// `sessions`——所以 `agents` 必须由我们随 mount 放进行作用域，否则 `ctx.get('agents')` 是
// `undefined`，每一次 `answer` / `attachWait` 都会按 `CALLER_NOT_LIVE` 拒绝。
//
// **兜底派发**：上游 `ask` 的 waterfall 在我们的装配里收不到转发源（实测：监听器被调用、请求也入了
// 队列，但 `ask` 仍按 `NO_PROVIDER` 结束）。所以在它报 `NO_PROVIDER` 时，用这一行的 ctx 再派发一次：
// 监听器与这里在同一棵事件树上，这一条必中。只在第一次「没有任何人应答」时发生，不改变成功路径。
import UserQuestionService from "@deepseek-ai/dsh-user-questions";
import { scopeTarget } from "@deepseek-ai/dsh-scope";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { UserQuestionQueue } from "./contract/user-question-queue.contract.ts";

/** 上游实例上的 `ask`（注入方拿到的就是它，所以兜底要挂在实例上）。 */
interface QuestionFace {
  ask: (request: never) => Promise<unknown>;
}

@Injectable()
export class UserQuestionQueueDefault extends fromCordis(UserQuestionQueue, UserQuestionService) {
  private readonly sessions = inject(SessionStore);

  private readonly agents = inject(AgentDirectory);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessions: this.sessions, agents: this.agents });
    const face = (this as unknown as Record<symbol, QuestionFace | undefined>)[
      Symbol.for("morlay.zephyr.contract-face")
    ];
    if (face === undefined || typeof face.ask !== "function") return;
    const upstreamAsk = face.ask.bind(face);
    face.ask = async (request: never) => {
      try {
        return await upstreamAsk(request);
      } catch (error) {
        const agent = (request as { readonly agent?: object }).agent;
        if (agent === undefined || !/no user-questions answerer/u.test(String(error))) throw error;
        // 与上游同一条 waterfall，只是**从这一行**派发：监听器就在这棵树上。
        return await dispatchQuestion(ctx, agent, request);
      }
    };
  }
}

/**
 * 从给定 ctx 派发一次提问 waterfall（带 scope carrier，监听器据此认出归属的 agent）。
 * @param ctx - 派发点（提问服务所在的那一行）。
 * @param agent - 请求所属的 agent（同时作为 carrier 与请求字段）。
 * @param request - 原样的提问请求。
 * @returns 应答者给出的答案。
 */
async function dispatchQuestion(ctx: Context, agent: object, request: unknown): Promise<unknown> {
  const carrier = scopeTarget(agent, agent);
  const waterfall = (
    ctx as unknown as {
      waterfall(receiver: object, event: string, ...args: unknown[]): Promise<unknown>;
    }
  ).waterfall.bind(ctx);
  return await waterfall(carrier, "user-questions/request", { ...(request as object), agent }, () =>
    Promise.reject(new Error("no user-questions answerer accepted the request")),
  );
}

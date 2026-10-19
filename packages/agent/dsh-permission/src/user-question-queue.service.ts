// 用户提问：上游 `UserQuestionService` 经 `fromCordis` 接管。
//
// 上游服务内部用 `ctx.get('agents')` 做「调用方是不是注册表里的 exact live agent」这一判断
// （`vendor/.../interaction/user-questions/src/index.ts:137-141`），而它自己的 `static inject` 只有
// `sessions`——所以 `agents` 必须由我们随 mount 放进行作用域，否则 `ctx.get('agents')` 是
// `undefined`，每一次 `answer` / `attachWait` 都会按 `CALLER_NOT_LIVE` 拒绝。
import UserQuestionService from "@deepseek-ai/dsh-user-questions";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { UserQuestionQueue } from "./contract/user-question-queue.contract.ts";

@Injectable()
export class UserQuestionQueueDefault extends fromCordis(UserQuestionQueue, UserQuestionService) {
  private readonly sessions = inject(SessionStore);

  private readonly agents = inject(AgentDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessions: this.sessions, agents: this.agents });
  }
}

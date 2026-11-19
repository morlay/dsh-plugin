// ToolAskUser（工具行）：模型面向的 `ask_user_question`，落在上游 `userQuestions` 队列上。
//
// 单参 `fromCordis`：这一行没有第二个消费方按能力注入它（令牌从上游插件名派生
// `tool-ask-user`），所以不造契约。
import * as ToolAskUserPlugin from "@deepseek-ai/dsh-tool-ask-user";
import { AgentScoped, ToolRegistry } from "@morlay/dsh-agent";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
// 兄弟面的契约走包出口（同包自引）：`../contract/` 会把契约类在另一个子出口产物里再内联一份。
import { UserQuestionQueue } from "@morlay/dsh-permission/contract";

@AgentScoped()
@Injectable()
export class ToolAskUser extends fromCordis(ToolAskUserPlugin) {
  tools = inject(ToolRegistry);

  // 上游按名字 `userQuestions` 读它（`ctx.userQuestions.ask`），deps 的键就是那个名字。
  userQuestions = inject(UserQuestionQueue);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      userQuestions: this.userQuestions,
    });
  }
}

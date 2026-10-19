// 用户提问：上游 `UserQuestionService` 经 `fromCordis` 接管。
import UserQuestionService from "@deepseek-ai/dsh-user-questions";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { UserQuestions } from "./user-questions.contract.ts";

@Injectable()
export class UserQuestionsDefault extends fromCordis(UserQuestions, UserQuestionService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

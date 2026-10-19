// 用户提问契约：令牌按服务语义命名（上游注册名 `userQuestions`）。
import type UserQuestionService from "@deepseek-ai/dsh-user-questions";
import { Injectable } from "@morlay/zephyr";

interface UserQuestionsFace {
  readonly ask: UserQuestionService["ask"];
}

@Injectable()
export abstract class UserQuestions implements UserQuestionsFace {
  abstract readonly ask: UserQuestionsFace["ask"];
}

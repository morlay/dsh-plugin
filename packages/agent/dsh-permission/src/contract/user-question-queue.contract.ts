// 用户提问契约：令牌按服务语义命名（上游注册名 `userQuestions`）。
import type UserQuestionService from "@deepseek-ai/dsh-user-questions";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `UserQuestionService` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/**
 * 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。
 *
 * `typertRemote` 不进契约：它是 `TypertRemoteService` 的网关绑定（给 gateway 做发现用），
 * 不是服务面——上游插件从不按 `ctx.<service>.typertRemote` 取用。
 */
export type UserQuestionsCovered = AssertTrue<
  AssertCovered<Omit<UserQuestionService, "typertRemote">, UserQuestionQueue>
>;

@Injectable()
export abstract class UserQuestionQueue {
  abstract readonly ask: UserQuestionService["ask"];

  abstract readonly askTimed: UserQuestionService["askTimed"];

  abstract readonly attachWait: UserQuestionService["attachWait"];

  abstract readonly answer: UserQuestionService["answer"];
}


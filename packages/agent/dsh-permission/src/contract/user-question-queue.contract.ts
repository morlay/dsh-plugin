// 用户提问契约：令牌按服务语义命名（上游注册名 `userQuestions`）。
import type UserQuestionService from "@deepseek-ai/dsh-user-questions";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

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
 *
 * 为什么不是 `implements`：上游 `UserQuestionService` 是 cordis `Service` 类（带私有成员），
 * `implements` 会报 TS2720；签名守卫在这里等价。
 */
export type UserQuestionsCovered = AssertTrue<
  AssertCoveredStrict<Omit<UserQuestionService, "typertRemote">, UserQuestionQueue>
>;

@Injectable({ name: "userQuestions" })
export abstract class UserQuestionQueue {
  abstract readonly ask: UserQuestionService["ask"];

  abstract readonly askTimed: UserQuestionService["askTimed"];

  abstract readonly attachWait: UserQuestionService["attachWait"];

  abstract readonly answer: UserQuestionService["answer"];
}

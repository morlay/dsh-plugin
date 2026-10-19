// 授权契约：令牌按服务语义命名（上游注册名 `authorization`）。
import type { AuthorizationService } from "@deepseek-ai/dsh-authorization";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `AuthorizationService` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.authorization.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`；
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type AuthorizationCovered = AssertTrue<
  AssertCovered<AuthorizationService, Authorization>
>;

@Injectable()
export abstract class Authorization {
  abstract readonly registerFlow: AuthorizationService["registerFlow"];

  abstract readonly list: AuthorizationService["list"];

  abstract readonly describe: AuthorizationService["describe"];

  abstract readonly cancel: AuthorizationService["cancel"];

  abstract readonly begin: AuthorizationService["begin"];
}


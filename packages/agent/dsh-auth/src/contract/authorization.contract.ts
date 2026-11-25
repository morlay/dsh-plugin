// 授权契约：令牌按服务语义命名（上游注册名 `authorization`）。
import type { AuthorizationService } from "@deepseek-ai/dsh-authorization";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "authorization" })
export abstract class Authorization {
  abstract readonly registerFlow: AuthorizationService["registerFlow"];

  abstract readonly list: AuthorizationService["list"];

  abstract readonly describe: AuthorizationService["describe"];

  abstract readonly cancel: AuthorizationService["cancel"];

  abstract readonly begin: AuthorizationService["begin"];
}

/**
 * 覆盖守卫（严格）：上游 `AuthorizationService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type AuthorizationCovered = AssertTrue<AssertCoveredStrict<AuthorizationService, Authorization>>;

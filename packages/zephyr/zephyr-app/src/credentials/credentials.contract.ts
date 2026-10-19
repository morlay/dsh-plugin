// 凭证契约：令牌按服务语义命名。
//
// **home 在装配层（`zephyr-app`），不在 DI 核心**：`connection` 行必须把它交给上游
// `@deepseek-ai/dsh-client-connection`（那边 `inject: ['credentials']` 并调 `modifyRecord`）。
// 实现 `CredentialsDefault` 在 `dsh-auth`，测试用的 `CredentialsInMemory` 在 `./testing`。
//
// 对 `@deepseek-ai/dsh-credentials` 只有 **type-only** 依赖（仅为推导签名），无运行时耦合。
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { AssertCovered, AssertTrue } from "../contract-coverage.ts";
import { Injectable } from "@morlay/zephyr";

/**
 * 契约面：上游 `CredentialProvider` 的**全部**公开成员。
 *
 * 成员一个都不能少——上游插件按 `ctx.credentials.<member>` 取用（`connection` 行读 `modifyRecord`，
 * `credentials` 组的远端端点读 `describe`/`set`/`unset`），缺一个那条插件在运行期就是 `undefined`。
 */
type CredentialsFace = Pick<
  CredentialProvider,
  | "resolve"
  | "describe"
  | "set"
  | "unset"
  | "readRecord"
  | "describeRecord"
  | "listRecords"
  | "modifyRecord"
  | "deleteRecord"
>;

/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type CredentialsCovered = AssertTrue<AssertCovered<CredentialProvider, CredentialsFace>>;

@Injectable()
export abstract class Credentials implements CredentialsFace {
  abstract readonly resolve: CredentialsFace["resolve"];

  abstract readonly describe: CredentialsFace["describe"];

  abstract readonly set: CredentialsFace["set"];

  abstract readonly unset: CredentialsFace["unset"];

  abstract readonly readRecord: CredentialsFace["readRecord"];

  abstract readonly describeRecord: CredentialsFace["describeRecord"];

  abstract readonly listRecords: CredentialsFace["listRecords"];

  abstract readonly modifyRecord: CredentialsFace["modifyRecord"];

  abstract readonly deleteRecord: CredentialsFace["deleteRecord"];
}

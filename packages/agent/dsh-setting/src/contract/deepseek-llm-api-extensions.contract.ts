// DeepSeek LLM API 扩展注册表契约：令牌按服务语义命名。
//
// 上游不是 cordis `Service`：它是一份**注册表对象**（`register` 登记、`prepare` 在请求前把扩展折叠进
// 请求体），`fromCordis` 把上游实例接管到这个令牌上，所以契约面按上游实例的公开成员投影。
import type DeepSeekLlmApiExtensionRegistry from "@deepseek-ai/dsh-deepseek-llm-api-extensions";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `DeepSeekLlmApiExtensionRegistry` 的**全部**公开成员。
 *
 * 消费方按 `ctx.deepseekLlmApiExtensions.<member>` 取用（`llm-deepseek` 行在发请求前调 `prepare`），
 * 缺一个就是运行期 `undefined`；下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type DeepseekLlmApiExtensionsCovered = AssertTrue<
  AssertCovered<DeepSeekLlmApiExtensionRegistry, DeepseekLlmApiExtensions>
>;

@Injectable()
export abstract class DeepseekLlmApiExtensions {
  abstract readonly register: DeepSeekLlmApiExtensionRegistry["register"];

  abstract readonly prepare: DeepSeekLlmApiExtensionRegistry["prepare"];
}


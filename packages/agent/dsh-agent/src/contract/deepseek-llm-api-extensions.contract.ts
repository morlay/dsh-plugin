// DeepSeek LLM API 扩展注册表契约：令牌按服务语义命名（上游注册名 `deepseekLlmApiExtensions`）。
//
// 上游不是 cordis `Service`：它是一份**注册表对象**（`register` 登记、`prepare` 在请求前把扩展折叠进
// 请求体），`fromCordis` 把上游实例接管到这个令牌上，所以契约面按上游实例的公开成员投影。
import type DeepSeekLlmApiExtensionRegistry from "@deepseek-ai/dsh-deepseek-llm-api-extensions";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "deepseekLlmApiExtensions" })
export abstract class DeepseekLlmApiExtensions {
  abstract readonly register: DeepSeekLlmApiExtensionRegistry["register"];

  abstract readonly prepare: DeepSeekLlmApiExtensionRegistry["prepare"];
}

/**
 * 覆盖守卫（严格）：上游 `DeepSeekLlmApiExtensionRegistry` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type DeepseekLlmApiExtensionsCovered = AssertTrue<AssertCoveredStrict<DeepSeekLlmApiExtensionRegistry, DeepseekLlmApiExtensions>>;

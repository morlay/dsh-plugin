// LLM 运行时契约：令牌按服务语义命名（上游注册名 `llm`）。
import { LlmRuntime } from "../index.ts";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `LlmRuntime` 的**全部**公开成员。
 *
 * 成员一个都不能少——上游插件按 `ctx.llm.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type LlmCovered = AssertTrue<AssertCovered<LlmRuntime, Llm>>;

@Injectable()
export abstract class Llm {
  abstract readonly typertRemote: LlmRuntime["typertRemote"];

  abstract readonly registerAdapter: LlmRuntime["registerAdapter"];

  abstract readonly listProviders: LlmRuntime["listProviders"];

  abstract readonly registerConfigurableProviders: LlmRuntime["registerConfigurableProviders"];

  abstract readonly listConfigurableProviders: LlmRuntime["listConfigurableProviders"];

  abstract readonly registerModelDiscovery: LlmRuntime["registerModelDiscovery"];

  abstract readonly discoverModels: LlmRuntime["discoverModels"];

  abstract readonly remoteDiscoverModels: LlmRuntime["remoteDiscoverModels"];

  abstract readonly providerRetryPolicy: LlmRuntime["providerRetryPolicy"];

  abstract readonly imageRequestPricing: LlmRuntime["imageRequestPricing"];

  abstract readonly imageRequestTarget: LlmRuntime["imageRequestTarget"];

  abstract readonly fileRequestText: LlmRuntime["fileRequestText"];

  abstract readonly listModels: LlmRuntime["listModels"];

  abstract readonly resolveModelInfo: LlmRuntime["resolveModelInfo"];

  abstract readonly resolveCallConfig: LlmRuntime["resolveCallConfig"];

  abstract readonly prepareCall: LlmRuntime["prepareCall"];

  abstract readonly stream: LlmRuntime["stream"];
}


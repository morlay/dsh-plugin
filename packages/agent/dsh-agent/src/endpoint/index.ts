// agent 域的**端点面**（`@morlay/dsh-agent/endpoint`）：两端共用的值与类型。
//
// 上游把 LLM 的 remote 放在 `@deepseek-ai/dsh-llm/remote`，那归 agent 域所有；client 半（setting 的
// 模型设置页）从这里取，不再直连 `@deepseek-ai/dsh-llm`。放在 endpoint 而不是 contract：
// contract 只放抽象类 / 类型 / 纯函数，remote 令牌与 deps 键是两端共用的**值**。
import type { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { RemoteGroup, RemoteMethod, remoteGroupNameOf } from "@morlay/zephyr-app/remote";

export { TYPERT_REMOTE as LLM_REMOTE } from "@deepseek-ai/dsh-llm/remote";

/**
 * 组名（`llm`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function llmGroupName(): string {
  const group = remoteGroupNameOf(LlmEndpoint);
  if (group === undefined) throw new Error("LlmEndpoint 没有 @RemoteGroup：组名取不到");
  return group;
}

/**
 * `llm` 组：模型目录与「替某个设置命名空间去问 provider」。
 *
 * 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧的端点行继承它
 * 实现方法。方法签名从上游宿主面（`LlmRuntime`）推（`Parameters<…>` / `ReturnType<…>`）。
 */
@RemoteGroup({ name: "llm" })
export class LlmEndpoint {
  /**
   * 已注册的 provider 目录。
   * @returns 每个适配器声明的 provider 信息。
   */
  @RemoteMethod()
  async listProviders(): Promise<ReturnType<LlmRuntime["listProviders"]>> {
    throw new Error("llm/listProviders：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 可通过配置激活的 provider 路由目录。
   * @returns 目录里每一条的公开面。
   */
  @RemoteMethod()
  async listConfigurableProviders(): Promise<ReturnType<LlmRuntime["listConfigurableProviders"]>> {
    throw new Error("llm/listConfigurableProviders：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 替某个设置命名空间问 provider 有哪些模型。
   * @param _settingsNs - 持有这条 provider 配置的命名空间。
   * @param _request - 发现请求（基址、密钥引用等）。
   * @param _signal - 可选的取消边界。
   * @returns 发现的模型。
   */
  @RemoteMethod()
  async discoverModels(
    _settingsNs: Parameters<LlmRuntime["discoverModels"]>[0],
    _request: Parameters<LlmRuntime["discoverModels"]>[1],
    _signal?: Parameters<LlmRuntime["discoverModels"]>[2],
  ): ReturnType<LlmRuntime["discoverModels"]> {
    throw new Error("llm/discoverModels：契约类未实现（宿主侧要在子类里实现它）");
  }
}

// 子代理的 RPC 契约（`subagents/*`）：两端共用的形状。宿主实现在 `@morlay/dsh-agent-loop`。
export * from "./subagents-endpoint.ts";

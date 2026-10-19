// `llm` 组的 wire 面：请求与响应形状（两端共用，**没有实现**）。
//
// 组名与方法名只在 `server/` 的 `@RemoteGroup` / `@RemoteMethod` 上出现一次；这里只定义载荷。
import { LlmModelDiscoveryRequest, LlmDiscoveredModel, LlmProviderInfo } from "../index.ts";

/** `llm/listProviders` 的返回值：每条路由的展示元数据。 */
export type LlmListProvidersValue = readonly LlmProviderInfo[];

/** `llm/listConfigurableProviders` 的返回值：可在设置页配置的 provider 目录。 */
export type LlmListConfigurableProvidersValue = readonly {
  readonly provider: string;
  readonly settingsNs: string;
}[];

/** `llm/discoverModels` 的请求：设置命名空间 + 发现请求体（字段全可选，见上游 `LlmModelDiscoveryRequest`）。 */
export interface LlmDiscoverModelsRequest {
  readonly settingsNs: string;
  readonly request: LlmModelDiscoveryRequest;
}

/** `llm/discoverModels` 的返回值：发现到的模型列表。 */
export type LlmDiscoverModelsValue = readonly LlmDiscoveredModel[];

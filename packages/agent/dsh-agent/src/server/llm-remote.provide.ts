import { provide, type ProviderList } from "@morlay/zephyr";
import { LlmEndpoint } from "./llm-endpoint.service.ts";

// `/api` 的 `llm/*` 端点行（装饰器注册）。
//
// 单独成模块而不是塞进 `AgentModule`：端点行要 `RemoteHandlers`（装配能力，只有 host 面有），
// 而 `AgentModule` 被大量只测 agent 域的 spec 直接装——混在一起会让每个 spec 都被迫补 `RemoteHandlers`。
const providers = (): ProviderList => [LlmEndpoint];

export const provideLlmRemote = provide(providers());

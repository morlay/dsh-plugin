import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { LlmEndpoint } from "./llm-endpoint.service.ts";

// `/api` 的 `llm/*` 端点行（装饰器注册）。
//
// 单独成模块而不是塞进 `AgentModule`：端点行要 `RemoteHandlers`（装配能力，只有 host 面有），
// 而 `AgentModule` 被大量只测 agent 域的 spec 直接装——混在一起会让每个 spec 都被迫补 `RemoteHandlers`。
export const provideLlmRemote = provide([
  LlmEndpoint,
  remoteDescriptor(() => import("@deepseek-ai/dsh-llm/remote")),
]);

import { provide, type ProviderList } from "@morlay/zephyr";
import { SessionReferenceDefault } from "./session-reference.service.ts";

// `remote.sessionReferenceResolver` 的宿主面：上游 `SessionReferenceResolver` + `candidates` 端点。
//
// 单独成模块（不塞进 `AgentModule`）：这条行要 `SessionQuery` 与 wire 的 handler 表，
// 只装 agent 栈（循环 / 会话）的装配不该被迫带上它们。它住在 agent 包，是因为解析候选要 `AgentDirectory`。
const providers = (): ProviderList => [SessionReferenceDefault];

export const provideSessionReference = provide(providers());

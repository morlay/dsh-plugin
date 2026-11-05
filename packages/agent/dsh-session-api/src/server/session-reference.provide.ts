import { provide, type ProviderList } from "@morlay/zephyr";
import { SessionReferenceDefault } from "./session-reference.service.ts";

// `remote.sessionReferenceResolver` 的宿主面：上游 `SessionReferenceResolver` + `candidates` 端点。
//
// **归属：会话域**（`sessionReferenceResolver` 是会话引用的解析面）。
// 它要 `SessionQuery`（本域）与 `AgentDirectory`（agent 域）——`dsh-session` 本就已经依赖 `dsh-agent`，
// 放在这里不新增反向依赖；放在 agent 包才是错位（会话概念寄居在 agent 域里）。
const providers = (): ProviderList => [SessionReferenceDefault];

export const provideSessionReference = provide(providers());

import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { AgentInstruction } from "./agent-instruction.service.ts";

// `maxBytes` 是上游**必填**的上限（`z.number().required()`）：取 64 KiB，与上游 `base` 补丁一致。
const providers = (): ProviderList => [configure(AgentInstruction, { maxBytes: 64 * 1024 })([AgentInstruction])];

export const provideAgentInstruction = provide(providers());

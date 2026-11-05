// LLM provider 的**配置行**装配：两家 provider（DeepSeek API key / pi-ai）。
//
// 为什么在 agent：这两个行配的是「agent 用哪家模型」，它们的 `Config` 就是 agent 的配置；
// 设置页只是**读**它们注册的 schema（`SettingSchema`），不拥有它们。
import { provide } from "@morlay/zephyr";
import { LlmDeepseek } from "./llm-deepseek.service.ts";
import { LlmPiAi } from "./llm-pi-ai.service.ts";

/**
 * headless 装配：两家 LLM provider 的配置行。
 * @returns 装配清单（可继续 `configure` 某一行的 `Config`）。
 */
export const provideLlmProviders = provide([LlmDeepseek, LlmPiAi]);

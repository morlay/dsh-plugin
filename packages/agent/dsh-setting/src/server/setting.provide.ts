import { provide, type ProviderList } from "@morlay/zephyr";
import { DeepseekLlmApiExtensionsDefault } from "../deepseek-llm-api-extensions.service.ts";
import { SettingEndpointDefault } from "./setting-endpoint.service.ts";
import { SettingLoader } from "../setting-loader.service.ts";
import { SettingSchema } from "../setting-schema.service.ts";
import { SettingDefault } from "../setting.service.ts";
import { LlmDeepseek } from "../llm-deepseek.service.ts";
import { LlmPiAi } from "../llm-pi-ai.service.ts";
import { UiThemeSchema } from "../ui-theme-schema.service.ts";

// 配置域的装配面：`/api` 的 provider 选项由这一行汇总。
// LLM provider 行：上游「API key 注册表」的实现，装了才有 provider 目录（设置里的「模型」页签读它）。
// 两条都装：它们是各自 namespace（`llm-deepseek` / `llm-pi-ai`）的注册者，键值是用户在设置里填的。
const providers = (): ProviderList => [
  // IO（读一次 / 串行落盘）与各 namespace 的配置 schema 注册表。
  SettingLoader,
  SettingSchema,
  DeepseekLlmApiExtensionsDefault,
  LlmDeepseek,
  LlmPiAi,
  // `ui-theme` 的 durable schema（不是 provider：主题没有模型可选，但它的默认层必须由 schema 给出）。
  UiThemeSchema,
  // 配置文档（`<dataDir>/settings.json`）与它的 wire 面。
  SettingDefault,
  SettingEndpointDefault,
];

export const provideSetting = provide(providers());

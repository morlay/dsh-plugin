import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { SettingEndpointDefault } from "./setting-endpoint.service.ts";
import { SettingLoader } from "../setting-loader.service.ts";
import { SettingSchema } from "@morlay/zephyr-app";
import { SettingDefault } from "../setting.service.ts";

// setting 的装配面：**机制**（IO + 注册表 + 文档 + 端点）。
//
// LLM provider 行不在这里：它们是 agent 的装配（`@morlay/dsh-agent` 的 `provideLlmProviders`）。
//
// 别的模块的设置项不在这里：`ui-settings`（开发者工具偏好）与 `ui-theme` 的 schema 由
// `@morlay/zephyr-ui` 注册，LLM API 扩展注册表在 `@morlay/dsh-agent`——它们各自用自己的装配函数。
export const provideSetting = provide([
  // IO（读一次 / 串行落盘）与各 namespace 的配置 schema 注册表。
  SettingLoader,
  SettingSchema,
  // 配置文档（`<dataDir>/settings.json`）。
  SettingDefault,
  // 配置文档的 wire 面。
  SettingEndpointDefault,
  remoteDescriptor(() => import("@deepseek-ai/dsh-api-settings-controller/remote")),
]);

import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { ImageOffload } from "./image-offload.service.ts";
import { McpResources } from "./mcp-resources.service.ts";
import { RepeatToolReminder } from "./repeat-tool-reminder.service.ts";
import { TimeoutPolicy } from "./timeout-policy.service.ts";

// 工具**调用生命周期**上的四条行：重复提醒、调用超时、图片外置、MCP 资源。
// 它们都不是工具本身（工具定义在上游插件里），所以没有自己的注册表，也没有自己的契约。
const providers = (): ProviderList => [
  configure(RepeatToolReminder, { thresholds: [3, 5, 8], argumentsPreviewChars: 500 })([RepeatToolReminder]),
  TimeoutPolicy,
  ImageOffload,
  McpResources,
];

export const provideToolPolicy = provide(providers());

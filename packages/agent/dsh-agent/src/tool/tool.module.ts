// 工具**行**（具体实现）：契约与 `ToolsDefault` 在根上（跨包必引），这里只放工具实现行。
import { Module, type ProviderList } from "@morlay/zephyr";
import { RepeatToolReminder } from "./repeat-tool-reminder.service.ts";
import { TimeoutPolicy } from "./timeout-policy.service.ts";
import { ImageOffload } from "./image-offload.service.ts";
import { McpResources } from "./mcp-resources.service.ts";

const providers = (): ProviderList => [
  RepeatToolReminder.withConfig({ thresholds: [3, 5, 8], argumentsPreviewChars: 500 }),
  TimeoutPolicy,
  ImageOffload,
  McpResources,
];

@Module({ providers: providers() })
export class ToolModule {
  static withConfig(): ProviderList {
    return providers();
  }
}

// 兼容旧名（装配面曾用 `ToolRowsModule`）。
export { ToolModule as ToolRowsModule };

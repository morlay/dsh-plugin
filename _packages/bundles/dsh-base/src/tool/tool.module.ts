import { Module, without, type ProviderList } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { ToolsDefault } from "./tools.service.ts";
import { ToolBash } from "./tool-bash.service.ts";
import { ToolFs } from "./tool-fs.service.ts";
import { ToolJobs } from "./tool-jobs.service.ts";
import { ToolWorkingDirectory } from "./tool-working-directory.service.ts";
import { ToolFsSearch } from "./tool-fs-search.service.ts";
import { ToolSkill } from "./tool-skill.service.ts";
import { ToolTodo } from "./tool-todo.service.ts";
import { ToolGoal } from "./tool-goal.service.ts";
import { RepeatToolReminder } from "./repeat-tool-reminder.service.ts";
import { ToolWeb } from "./tool-web.service.ts";
import { TimeoutPolicy } from "./timeout-policy.service.ts";
import { ToolResultPruner } from "./tool-result-pruner.service.ts";
import { ImageOffload } from "./image-offload.service.ts";
import { McpResources } from "./mcp-resources.service.ts";
import { SpillLocal } from "./spill-local.service.ts";
import { SpillPolicy } from "./spill-policy.service.ts";
import { ToolWorkflow } from "./tool-workflow.service.ts";

const providers = (): ProviderList => [
  ToolsDefault,
  ToolBash,
  without(ToolBash, jsExpr(() => process.platform === "win32")),
  ToolFs,
  ToolJobs,
  ToolWorkingDirectory,
  ToolFsSearch.withConfig({ sampleOverCapGlobResults: false }),
  ToolSkill,
  ToolTodo.withConfig({ allowParallelInProgress: true }),
  ToolGoal,
  RepeatToolReminder.withConfig({ thresholds: [3, 5, 8], argumentsPreviewChars: 500 }),
  ToolWeb.withConfig({ fetch: true, searchTimeoutMs: 60000 }),
  TimeoutPolicy,
  ToolResultPruner.withConfig({ thresholdChars: 8192, headChars: 4096, tailChars: 1024 }),
  ImageOffload,
  McpResources,
  SpillLocal,
  SpillPolicy.withConfig({ maxInlineTokens: 12500 }),
  ToolWorkflow,
];

@Module({ providers: providers() })
export class ToolModule {
  static withConfig(): ProviderList {
    return providers();
  }
}

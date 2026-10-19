import { Module, without, type ProviderList } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { AgentModule } from "@morlay/dsh-base/agent";
import { CommandCompactModule } from "@morlay/dsh-base/compaction";
import { CommandFeedbackModule } from "@morlay/dsh-base/feedback";
import { CommandGoalModule } from "@morlay/dsh-base/goal";
import { CommandsModule } from "@morlay/dsh-base/commands";
import { GoalModule } from "@morlay/dsh-base/goal";
import { GoalRoundDriverModule } from "@morlay/dsh-base/goal";
import { PlanModeModule } from "@morlay/dsh-base/plan-mode";
import { SkillModule } from "@morlay/dsh-base/skill";
import { SkillFilesystemModule } from "@morlay/dsh-base/skill";
import { LlmModule, type LlmPiAiOptions } from "@morlay/dsh-base/llm";
import { LoaderModule } from "@morlay/dsh-base/loader";
import { RuntimeModule } from "@morlay/dsh-base/runtime";
import { SubagentModule } from "@morlay/dsh-base/subagent";
import { SandboxModule } from "@morlay/dsh-base/sandbox";
import { SessionModule } from "@morlay/dsh-base/session";
import { SessionProjectionModule } from "@morlay/dsh-base/session-projection";
import { SessionPersistenceJsonlModule } from "@morlay/dsh-base/session-persistence";
import { SessionQuerySqliteModule } from "@morlay/dsh-base/session-query";
import { SessionTitleModule } from "@morlay/dsh-base/session-title";
import { SessionTitleLlmModule } from "@morlay/dsh-base/session-title";
import { SessionLogDeepseekModule } from "@morlay/dsh-base/session-log";
import { SessionProjectionCacheModule } from "@morlay/dsh-base/session-projection";
import { SessionCheckpointPolicyModule } from "@morlay/dsh-base/session";
import { TokenMeterModule } from "@morlay/dsh-base/token-meter";
import { CompactionBasicModule } from "@morlay/dsh-base/compaction";
import { StorageModule } from "@morlay/dsh-base/storage";
import { TelemetryModule } from "@morlay/dsh-base/telemetry";
import { ToolModule } from "@morlay/dsh-base/tool";
import { TypertModule } from "@morlay/dsh-base/typert";
import { WebModule } from "@morlay/dsh-base/web";
import { WorkflowModule } from "@morlay/dsh-base/workflow";

// 上游 disabled 行：运行期不注册，只在 patch 里保留 disabled insert。
class PluginManager {}
class Hmr {}
class ConfigEditor {}
class Settings {}
class ToolPluginManager {}
class PwshSandbox {}
class ToolPwsh {}

export interface DshBaseOptions {
  llmPiAi?: LlmPiAiOptions;
}

const modules = [
  LlmModule,
  LoaderModule,
  StorageModule,
  TypertModule,
  WebModule,
  SandboxModule,
  ToolModule,
  SessionModule,
  SessionProjectionModule,
  SessionPersistenceJsonlModule,
  SessionQuerySqliteModule,
  SessionTitleModule,
  SessionTitleLlmModule,
  SessionLogDeepseekModule,
  SessionProjectionCacheModule,
  SessionCheckpointPolicyModule,
  TokenMeterModule,
  CompactionBasicModule,
  AgentModule,
  SkillModule,
  SkillFilesystemModule,
  CommandsModule,
  CommandFeedbackModule,
  GoalModule,
  GoalRoundDriverModule,
  PlanModeModule,
  CommandGoalModule,
  CommandCompactModule,
  WorkflowModule,
  RuntimeModule,
  SubagentModule,
  TelemetryModule,
] as const;

@Module({
  imports: modules,
  providers: [
    without({ provide: PluginManager }, jsExpr((ctx) => !ctx.get("profileContext"))),
    without({ provide: Hmr, useValue: { root: [] } }, jsExpr((ctx) => !ctx.get("profileContext"))),
    without({ provide: ConfigEditor }, jsExpr((ctx) => !ctx.get("profileContext"))),
    without({ provide: Settings }, jsExpr((ctx) => !ctx.get("profileContext"))),
    without({ provide: ToolPluginManager }, true),
    without({ provide: PwshSandbox }, jsExpr(() => process.platform !== "win32")),
    without({ provide: ToolPwsh }, jsExpr(() => process.platform !== "win32")),
  ],
})
export class DshBaseModule {
  static withConfig(options: DshBaseOptions = {}): ProviderList {
    return [
      ...LlmModule.withConfig({ llmPiAi: options.llmPiAi }),
      ...LoaderModule.withConfig(),
      ...StorageModule.withConfig(),
      ...TypertModule.withConfig(),
      ...WebModule.withConfig(),
      ...SandboxModule.withConfig(),
      ...ToolModule.withConfig(),
      ...SessionModule.withConfig(),
      ...SessionProjectionModule.withConfig(),
      ...SessionPersistenceJsonlModule.withConfig(),
      ...SessionQuerySqliteModule.withConfig(),
      ...SessionTitleModule.withConfig(),
      ...SessionTitleLlmModule.withConfig(),
      ...SessionLogDeepseekModule.withConfig(),
      ...SessionProjectionCacheModule.withConfig(),
      ...SessionCheckpointPolicyModule.withConfig(),
      ...TokenMeterModule.withConfig(),
      ...CompactionBasicModule.withConfig(),
      ...AgentModule.withConfig(),
      ...SkillModule.withConfig(),
      ...SkillFilesystemModule.withConfig(),
      ...CommandsModule.withConfig(),
      ...CommandFeedbackModule.withConfig(),
      ...GoalModule.withConfig(),
      ...GoalRoundDriverModule.withConfig(),
      ...PlanModeModule.withConfig(),
      ...CommandGoalModule.withConfig(),
      ...CommandCompactModule.withConfig(),
      ...WorkflowModule.withConfig(),
      ...RuntimeModule.withConfig(),
      ...SubagentModule.withConfig(),
      ...TelemetryModule.withConfig(),
      without({ provide: PluginManager }, jsExpr((ctx) => !ctx.get("profileContext"))),
      without({ provide: Hmr, useValue: { root: [] } }, jsExpr((ctx) => !ctx.get("profileContext"))),
      without({ provide: ConfigEditor }, jsExpr((ctx) => !ctx.get("profileContext"))),
      without({ provide: Settings }, jsExpr((ctx) => !ctx.get("profileContext"))),
      without({ provide: ToolPluginManager }, true),
      without({ provide: PwshSandbox }, jsExpr(() => process.platform !== "win32")),
      without({ provide: ToolPwsh }, jsExpr(() => process.platform !== "win32")),
    ];
  }
}

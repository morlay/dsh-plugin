// 装配面：**只认 provider 清单**。业务能力一律来自各包的 `provideXxx()`；装配面自己只剩下三样东西：
//   1. 需要部署值的域（`provideXxx(configure(实现类, {...}))`，路径/档位这类只有启动器知道的事实）；
//   2. 应用级的两个 Provider（`deploymentProviders` 末尾，需要应用配置）；
//   3. framework 链（`@morlay/zephyr-app` 的 `provideXxx()`）。
//
// 装配面**不写补洞行**：客户端会调而宿主没有的端点，缺什么就把对应域装起来。
//
// 分十组而不是一个长数组：每组是一个装配单元（「会话」「任务」「工具」…），读的人按组找，
// 顺序只在 `customProvidersOf` 里出现一次（依赖顺序：提供方在前）。
//
// `LaunchEnvironment` 不在这里：它的读者是按上游服务名取值的 `launchEnvironmentOf(ctx)`，
// 而本装配里用到它的 `llm-deepseek-account` 行不在装配中，装上来没有任何读者。
import { configure, type ProviderEntry } from "@morlay/zephyr";
import {
  AppEnvDefault,
  ClientRowsDefault,
  provideApiGateway,
  provideClientModules,
  provideConnection,
  provideLoggerExporter,
  provideMuxServer,
  provideRemoteAccess,
  provideTypert,
  provideWeb,
} from "@morlay/zephyr-app";
import { LlmEndpoint, provideAgent, provideSessionReference } from "@morlay/dsh-agent/server";
import { provideAgentInstruction } from "@morlay/dsh-agent-instruction";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideSessionCheckpointPolicy } from "@morlay/dsh-checkpoint-policy";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideCommandCompact, provideCompactionBasic } from "@morlay/dsh-compaction";
import { provideCommandFeedback, provideSessionLogDeepseek } from "@morlay/dsh-deepseek-feedback";
import { provideEnvTool } from "@morlay/dsh-env-tool";
import { provideCommandGoal, provideGoal, provideGoalRoundDriver } from "@morlay/dsh-goal/server";
import { provideJob } from "@morlay/dsh-job/server";
import { type PermissionMode } from "@morlay/dsh-permission";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { providePlanMode } from "@morlay/dsh-plan-mode/server";
import { providePtc } from "@morlay/dsh-ptc";
import { SandboxPolicyDefault, provideSandbox, provideWorkspaceFiles } from "@morlay/dsh-sandbox";
import { provideSessionProjectionCache, provideSessionRemote, provideSessionsHost, provideTokenMeter } from "@morlay/dsh-session/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideSessionTitle, provideSessionTitleLlm } from "@morlay/dsh-session-title";
import { provideSetting } from "@morlay/dsh-setting/server";
import { provideShell } from "@morlay/dsh-shell";
import { provideSkill, provideSkillFilesystem } from "@morlay/dsh-skill/server";
import { provideStorage } from "@morlay/dsh-storage";
import { provideSubagent } from "@morlay/dsh-subagent/server";
import { provideTelemetry } from "@morlay/dsh-telemetry";
import { provideToolOutput } from "@morlay/dsh-tool-output";
import { provideToolPolicy } from "@morlay/dsh-tool-policy";
import { provideUpload } from "@morlay/dsh-upload/server";
import { provideToolWeb, provideWebAccess } from "@morlay/dsh-web-access/server";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-working-directory";
import { resolve } from "node:path";

const appRoot = process.cwd();
// 路径只在装配面算一次：`AppEnv.dataDir` 与各层的子目录都从它拼，避免两处硬编码漂移。
const dataDir = resolve(appRoot, ".dsh-store");
// 权限档位也只在这里读一次：它同时写沙箱模式与批准策略两个开关。
const permissionMode = (process.env.DSH_PERMISSION_MODE ?? "workspace-write") as PermissionMode;

/**
 * 入口清单：十组装配单元按依赖顺序拼起来。
 * @param rows - client 行包清单（`clientPackagesOf` 在入口先算好再传进来）。
 * @returns 完整的 provider 清单。
 */
export function customProvidersOf(rows: readonly string[]): ProviderEntry[] {
  return [
    ...frameworkProviders(),
    ...sessionProviders(),
    ...instructionProviders(),
    ...environmentProviders(),
    ...settingsProviders(),
    ...agentProviders(),
    ...taskProviders(),
    ...workspaceProviders(),
    ...toolProviders(),
    ...deploymentProviders(rows),
  ];
}

/** framework 链：宿主与前端面（`@morlay/zephyr-app`）。 */
function frameworkProviders(): ProviderEntry[] {
  return [
    ...provideWeb(),
    ...provideConnection(),
    ...provideTypert(),
    ...provideRemoteAccess(),
    ...provideApiGateway(),
    ...provideMuxServer(),
    ...provideLoggerExporter(),
    ...provideClientModules(),
  ];
}

/** 会话域：存储 / 投影 / 计量 / 标题 / 检查点 / 反馈 / 宿主表 / 远端面。 */
function sessionProviders(): ProviderEntry[] {
  return [
    ...provideSessionPersistence(),
    ...provideSessionProjectionCache(),
    ...provideTokenMeter(),
    ...provideSessionTitle(),
    ...provideSessionTitleLlm(),
    ...provideSessionCheckpointPolicy(),
    ...provideSessionLogDeepseek(),
    ...provideCommandFeedback(),
    ...provideSessionsHost(),
    // 会话的远端面：它自带真 store / 投影 / 查询三份 root，所以这里不再单列它们。
    ...provideSessionRemote(),
  ];
}

/** agent 指令 / 压缩 / 技能 / 工具输出。 */
function instructionProviders(): ProviderEntry[] {
  return [
    ...provideAgentInstruction(),
    ...provideCompactionBasic(),
    ...provideCommandCompact(),
    ...provideSkillFilesystem(),
    ...provideSkill(),
    ...provideToolOutput(),
  ];
}

/** 环境面：ptc / 附件 / 上传 / 存储 hub（后端由 `deploymentProviders` 的 `providePersistence` 装）。 */
function environmentProviders(): ProviderEntry[] {
  return [...providePtc(), ...provideAttachment(), ...provideUpload(), ...provideStorage()];
}

/** 认证与配置。 */
function settingsProviders(): ProviderEntry[] {
  return [...provideAuth(), ...provideSetting()];
}

/** agent 核心：目录 / 模型 / 工具注册表 / 循环 / 命令 / 子代理。 */
function agentProviders(): ProviderEntry[] {
  return [...provideAgent(), ...provideCommand(), ...provideSubagent()];
}

/** 任务面：goal（含命令与轮次驱动）/ job / plan-mode。 */
function taskProviders(): ProviderEntry[] {
  return [
    ...provideCommandGoal(),
    ...provideGoal(),
    ...provideGoalRoundDriver(),
    ...provideJob(),
    ...providePlanMode(),
  ];
}

/** 工作区 / 目录选择（host 面）。 */
function workspaceProviders(): ProviderEntry[] {
  return [
    ...provideWorkspace(),
    // `remote.workspaceFiles` 的宿主面（上游 `WorkspaceFiles` + 五条端点）：要沙箱策略与会话/持久化，
    // 所以由装配面显式装上，不塞进 `provideSandbox()`。
    ...provideWorkspaceFiles(),
    // `remote.sessionReferenceResolver/candidates` 的宿主面（上游 `SessionReferenceResolver`）。
    ...provideSessionReference(),
  ];
}

/** 工具面：环境工具 / 工具策略 / web 访问 / 遥测 / `llm/*` 的 wire 行。 */
function toolProviders(): ProviderEntry[] {
  return [
    ...provideEnvTool(),
    ...provideToolPolicy(),
    ...provideWebAccess(),
    ...provideToolWeb(),
    ...provideTelemetry(),
    // `llm/*` 的 wire 面：它是 Provider（不是域装配函数）。
    LlmEndpoint,
  ];
}

/**
 * 需要部署值的域 + 本应用自己的两个 Provider（路径与档位只在这一处给，包内只留默认值）。
 * @param rows - client 行包清单。
 * @returns provider 清单。
 */
function deploymentProviders(rows: readonly string[]): ProviderEntry[] {
  return [
    ...provideShell(),
    ...provideSandbox(
      configure(SandboxPolicyDefault, { mode: permissionMode, workspaceRoot: appRoot }),
    ),
    ...provideWorkingDirectory(
      configure(WorkingDirectoryDefault, { defaultDirectory: appRoot }),
    ),
    ...providePermissionFor(permissionMode),
    // 存储根目录显式给（路径只从 AppEnv 的 dataDir 派生）：后端行是 `dsh-persistence` 的，hub 在 `dsh-storage`。
    ...providePersistence(configure(StorageJsonDefault, { root: resolve(dataDir, "storages") })),
    // 本应用自己的两个 Provider：路径全部在这里显式给（不读环境变量、不向上找目录）。
    ...configure(AppEnvDefault, {
      // cwd 就是解析根（`just web` 在仓库根/启动器目录跑，node 的解析链从它出发）。
      profileDir: appRoot,
      dataDir,
      dev: true,
      aggregate: ["@deepseek-ai/*"],
    })([AppEnvDefault]),
    ...configure(ClientRowsDefault, rows)([ClientRowsDefault]),
  ];
}

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
import { configure, without, type ProviderEntry } from "@morlay/zephyr";
import {
  AppEnvDefault,
  ClientRowsDefault,
  provideApiGateway,
  provideAppEnv,
  provideClientModules,
  provideConnection,
  provideLoggerExporter,
  provideMuxServer,
  provideRemoteAccess,
  provideTypert,
  provideServerHmr,
  provideWeb,
} from "@morlay/zephyr-app";
import { LlmEndpoint, provideAgent } from "@morlay/dsh-agent/server";
import { provideAgentInstruction } from "@morlay/dsh-agent-instruction";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideSessionCheckpointPolicy } from "@morlay/dsh-checkpoint-policy";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideCommandCompact, provideCompactionBasic } from "@morlay/dsh-compaction";
import { provideEnvTool } from "@morlay/dsh-env-tool";
import { provideCommandGoal, provideGoal, provideGoalRoundDriver } from "@morlay/dsh-goal/server";
import { provideJob } from "@morlay/dsh-job/server";
import { type PermissionMode } from "@morlay/dsh-permission";
import { providePermissionFor } from "@morlay/dsh-permission/server";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { providePtc } from "@morlay/dsh-ptc";
import { SandboxPolicyDefault, provideSandbox, provideWorkspaceFiles } from "@morlay/dsh-sandbox";
import {
  provideSessionProjectionCache,
  provideSessionRemote,
  provideTokenMeter,
} from "@morlay/dsh-session/server";
import { provideApiSession, provideSessionReference, ScheduleRow } from "@morlay/dsh-session-api/server";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { provideSessionTitle, provideSessionTitleLlm } from "@morlay/dsh-session-title";
import { LlmPiAi } from "@morlay/dsh-setting";
import { provideSetting } from "@morlay/dsh-setting/server";
import { provideShell, provideTerminal } from "@morlay/dsh-shell";
import { provideSkill, provideSkillFilesystem, SkillCatalogRow } from "@morlay/dsh-skill/server";
import { provideStorage } from "@morlay/dsh-storage";
import { provideSubagent } from "@morlay/dsh-subagent/server";
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
 * 入口清单：每组是一个装配单元，按依赖顺序（提供方在前）拼起来。
 * @param rows - client 行包清单（`clientPackagesOf` 在入口先算好再传进来）。
 * @returns 完整的 provider 清单。
 */
export function customProvidersOf(rows: readonly string[]): ProviderEntry[] {
  return [
    // 认凭据的行放在最前：`connection` 行 mount 时就要 `Credentials` 的**面**（适配行的面在它自己的
    // mount 之后才绑上，排在后面就会拿到空壳——症状是 `credentials.modifyRecord is not a function`）。
    ...credentialsProviders(),
    ...frameworkProviders(rows),
    // 存储 hub 要排在会话域之前：会话的投影缓存 `onInit` 里就 `open` storage domain。
    ...storageProviders(),
    // 会话的**核心**行（store / 投影 / 查询 / 持久化 / 缓存 / 计量）：agent 域要它们的面。
    ...sessionCoreProviders(),
    // agent 核心排在配置域之前：配置里的 LLM provider 行要 `Llm` 的面。
    ...agentProviders(),
    // 配置域要 `Llm`；会话的标题 / 日志 / 命令反馈行又要配置域的 `deepseekLlmApiExtensions`。
    ...settingsProviders(),
    ...sessionFeatureProviders(),
    ...instructionProviders(),
    ...environmentProviders(),
    ...uploadProviders(),
    ...taskProviders(),
    ...workspaceProviders(),
    // 会话端点（上游 `session/*` 控制器）：要 `fileUploads`、工作区注册表与会话三份 root 的面，
    // 所以排在它们之后（排前面时上游读到的 `ctx.workspaceRegistry` 是适配行的壳）。
    ...sessionEndpointProviders(),
    ...toolProviders(),
    ...deploymentProviders(),
  ];
}

/**
 * framework 链：宿主与前端面（`@morlay/zephyr-app`）。
 * @param rows - client 行包清单：`provideClientModules()` 自己就带行清单条目，所以**不能**再单列一份
 *   `provideRows()`（同名服务会被注册两次）；配的部署值以 feature 的形式叠在它上面。
 * @returns provider 条目。
 */
function frameworkProviders(rows: readonly string[]): ProviderEntry[] {
  return [
    ...provideWeb(),
    // 开发态的服务端 HMR（生产形态不需要：那时源码不变）。入口负责 `install({ reload })`。
    ...provideServerHmr(),
    ...provideConnection(),
    ...provideTypert(),
    ...provideRemoteAccess(),
    ...provideApiGateway(),
    ...provideMuxServer(),
    ...provideLoggerExporter(),
    ...provideClientModules(configure(ClientRowsDefault, rows)),
  ];
}

/**
 * 会话域的核心行：存储 / 投影 / 查询 / 持久化 / 缓存 / 计量 / 检查点 / 宿主表。
 *
 * 下游（agent 域、配置域的 LLM 行）都按这里的面注入，所以它们必须在这一层全就位。
 */
function sessionCoreProviders(): ProviderEntry[] {
  return [
    ...provideSessionPersistence(),
    // 会话的远端面：它自带真 store / 投影 / 查询三份 root（`sessionProjections` 等），所以这里不再单列。
    // **必须排在这一组的前面**：下面几行的 `onInit` 都要那三份的面，排后面拿到的是空壳。
    ...provideSessionRemote(),
    ...provideSessionProjectionCache(),
    ...provideTokenMeter(),
    ...provideSessionCheckpointPolicy(),
    // `provideSessionsHost()` 不装：它就是 `provideSession()` 的真 store 行，而 `provideSessionRemote()`
    // 已经带上了（同名服务注册两次会直接抛 `service "sessions" has been registered`）。
  ];
}

/**
 * 会话域的**特性**行：标题 / 日志 / 命令反馈 / 端点。
 *
 * 它们要配置域的 `deepseekLlmApiExtensions`（LLM 的 API 扩展注册表）与 agent 域的 `Llm`，
 * 所以排在配置域与 agent 域之后。
 */
function sessionFeatureProviders(): ProviderEntry[] {
  return [
    ...provideSessionTitle(),
    ...provideSessionTitleLlm(),
  ];
}

/** agent 指令 / 压缩 / 技能 / 工具输出。 */
function instructionProviders(): ProviderEntry[] {
  return [
    ...provideAgentInstruction(),
    ...provideCompactionBasic(),
    ...provideCommandCompact(),
    // 注册表行在前：`skill-filesystem` 在它的 `apply` 里 `ctx.skills.registerProvider(...)`。
    // `without(SkillCatalogRow)`：本部署装了上游 `SessionController`（`provideApiSession()`），它自己在
    // init 里 `new SessionSkillCatalog(ctx)` 占住了 `sessionSkillCatalog`；适配行再装一遍就是同名重复注册。
    // 端点行按令牌优先、按名回退，所以两种拓扑都成立。
    ...provideSkill(without(SkillCatalogRow)),
    ...provideSkillFilesystem(),
    ...provideToolOutput(),
  ];
}

/**
 * 存储：hub 与 domain 行在前，**后端行在后**（后端在自己的 `onInit` 里 `ctx.storage.backend.register`，
 * 要求 hub 已就位；domain 是惰性的，第一次 `open` 时才查后端，所以它可以先挂）。
 */
function storageProviders(): ProviderEntry[] {
  return [
    ...provideStorage(),
    // 存储根目录显式给（路径只从 AppEnv 的 dataDir 派生）：后端行是 `dsh-persistence` 的，hub 在 `dsh-storage`。
    ...providePersistence(configure(StorageJsonDefault, { root: resolve(dataDir, "storages") })),
  ];
}

/** 环境面：ptc / 附件（上传行要 `AgentDirectory` / `CommandRegistry` 的面，另起一组排在 agent 之后）。 */
function environmentProviders(): ProviderEntry[] {
  return [...providePtc(), ...provideAttachment()];
}

/** 文件上传：要 agent 目录、附件、命令注册表、连接四份面，所以排在 agent 之后。 */
function uploadProviders(): ProviderEntry[] {
  return [...provideUpload()];
}

/**
 * 会话端点（上游 `SessionController` 那一族）：与 `provideSessionRemote()` 并列装，两者内部无相互
 * import（会成环）。它要 `fileUploads`、工作区分辨等面，所以排在装配的后段。
 */
function sessionEndpointProviders(): ProviderEntry[] {
  return [...provideApiSession()];
}

/** 认凭据：`Credentials` 的实现行（`connection` 行是它的消费方）。 */
function credentialsProviders(): ProviderEntry[] {
  return [...provideAuth()];
}

/**
 * 配置（上游 settings 的宿主半）。
 *
 * `llm-pi-ai` 的 **ollama route 默认配上**：没有它，「模型」目录是空的、输入区的模型座位选不了东西。
 * 配置分三层（行默认 → 装配 patch → `settings.json`），这里给的是第二层——用户在设置里改过之后
 * 以设置文档为准。
 */
function settingsProviders(): ProviderEntry[] {
  return [
    // feature 叠在 `provideSetting()` 的清单上（第二个参数是 feature 列表），与 `provideXxx(configure(...))`
    // 是同一套写法——装配面只给差异值，默认值仍由上游 schema 补。
    ...provideSetting(configure(LlmPiAi, {
      providers: {
        ollama: {
          // 走凭证服务读 `OLLAMA_API_KEY`（别把密钥写进配置）。
          apiKeyEnv: "OLLAMA_API_KEY",
          displayName: "Ollama Cloud",
          api: "anthropic-messages",
          baseURL: "https://ollama.com",
          // 与 `apiKeyEnv` 同一个 key：`apiKeyEnv` 决定"用哪个凭证"，这一条是把它带进请求头。
          headers: {
            Authorization: process.env.OLLAMA_API_KEY === undefined
              ? ""
              : `Bearer ${process.env.OLLAMA_API_KEY}`,
          },
          reasoning: "high",
          requestImageMaxBytes: 2_097_152,
          models: [
            {
              id: "deepseek-v4.1-flash:1017",
              name: "DeepSeek V4.1 Flash 1017 @ Ollama Cloud",
              contextWindow: 1_000_000,
              input: ["text", "image"],
              reasoningEfforts: { off: null, low: "low", high: "high", max: "max" },
            },
          ],
        },
      },
    })),
  ];
}

/** agent 核心：目录 / 模型 / 工具注册表 / 循环 / 命令 / 子代理。 */
function agentProviders(): ProviderEntry[] {
  return [...provideAgent(), ...provideCommand(), ...provideSubagent()];
}

/** 任务面：goal（含命令与轮次驱动）/ job。 */
function taskProviders(): ProviderEntry[] {
  return [
    ...provideCommandGoal(),
    ...provideGoal(),
    ...provideGoalRoundDriver(),
    ...provideJob(),
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
    ScheduleRow,
  ];
}

/** 工具面：环境工具 / 工具策略 / web 访问 / 遥测 / `llm/*` 的 wire 行。 */
function toolProviders(): ProviderEntry[] {
  return [
    ...provideEnvTool(),
    ...provideToolPolicy(),
    ...provideWebAccess(),
    ...provideToolWeb(),
    // `llm/*` 的 wire 面：它是 Provider（不是域装配函数）。
    LlmEndpoint,
  ];
}

/**
 * 需要部署值的域 + 本应用自己的 Provider（路径与档位只在这一处给，包内只留默认值）。
 * @returns provider 清单。
 */
function deploymentProviders(): ProviderEntry[] {
  return [
    ...provideShell(),
    ...provideSandbox(
      configure(SandboxPolicyDefault, { mode: permissionMode, workspaceRoot: appRoot }),
    ),
    ...provideWorkingDirectory(
      configure(WorkingDirectoryDefault, { defaultDirectory: appRoot }),
    ),
    // 右栏的终端：上游 `TerminalController` 的 `static inject` 要 `sandboxPolicy` / `workingDirectory`，
    // 而适配行是**同步 `new`**（`super(ctx, name)` 当场做 inject 检查），所以必须排在它们之后。
    ...provideTerminal(),
    ...providePermissionFor(permissionMode),
    // 部署参数（`AppEnv`）：路径全部在这里显式给（不读环境变量、不向上找目录）。
    // 装配形态是「清单 + 调用方的 feature」：`provideAppEnv` 只声明条目，部署值由
    // `configure(实现类, patch)` 叠加——feature 不能写进清单本身。
    ...provideAppEnv(
      configure(AppEnvDefault, {
        // cwd 就是解析根（`just web` 在仓库根/启动器目录跑，node 的解析链从它出发）。
        profileDir: appRoot,
        dataDir,
        dev: true,
        aggregate: ["@deepseek-ai/*"],
        // **remote 面清单**：`mountRemotes` 按它逐个 `import("@deepseek-ai/<name>/remote")` 并 `$mount`。
        // 不配就是"一个都不装"——UI 侧的 `remote.session` / `remote.workspace` 全是空的，
        // 界面能渲染但拿不到任何数据。
        remotes: [
          // 会话组：`session` / `fileReferences` / `skills`。
          "dsh-api-session-controller",
          // 会话引用候选（`@` 提及）。
          "dsh-session-reference",
          // 工作区与目录选择器。
          "dsh-api-workspace-controller",
          // 工作区文件读取（编辑器/预览）。
          "dsh-api-workspace-files",
          // 设置与凭据。
          "dsh-api-settings-controller",
          // 账号。
          "dsh-api-account-controller",
          // 后台任务。
          "dsh-api-job-controller",
          // 文件上传。
          "dsh-client-file-upload",
          // 命令（斜杠面板）。
          "dsh-commands",
          // 模型。
          "dsh-llm",
          // 定时提醒。
          "dsh-schedule",
          // 会话目标。
          "dsh-goal",
          // 权限档位。
          "dsh-permission-presets",
          // 右栏的终端（`terminal/*` 端点）。
          "dsh-api-terminal-controller",
        ],
      }),
    ),
  ];
}

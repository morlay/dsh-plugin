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
  provideApiGateway,
  provideAppEnv,
  provideConnection,
  provideLoggerExporter,
  provideMuxServer,
  provideRemoteAccess,
  provideTypert,
  provideServerHmr,
  provideWeb,
} from "@morlay/zephyr-app";
import { FederationDefault, provideClientModules } from "@morlay/zephyr-app/node";
import { provideAgent } from "@morlay/dsh-agent";
import { provideLlmRemote } from "@morlay/dsh-agent/server";
import { provideAgentInstruction } from "@morlay/dsh-agent-instruction";
import { provideAttachment } from "@morlay/dsh-attachment";
import { provideAuth } from "@morlay/dsh-auth/server";
import { provideAgentLoop } from "@morlay/dsh-agent-loop";
import { ToolExecutorNative } from "@morlay/dsh-agent-loop/server";
import { provideCommand } from "@morlay/dsh-command/server";
import { provideCommandCompact, provideCompactionBasic } from "@morlay/dsh-compaction";
import { provideJob } from "@morlay/dsh-job/server";
import { type PermissionMode } from "@morlay/dsh-permission";
import { providePermissionFor } from "@morlay/dsh-permission/server";

import { providePtc } from "@morlay/dsh-ptc";
import { SandboxPolicyDefault, provideFsTools, provideSandbox } from "@morlay/dsh-sandbox";
import { provideWorkspaceFiles } from "@morlay/dsh-workspace/server";
// 工具行（bash / 文件 / 检索 / 工作目录）归 agent：契约面是 ToolRegistry。
import { provideEnvTools } from "@morlay/dsh-agent/server";
import { provideTokenMeter } from "@morlay/dsh-session/server";
// 会话端点那一面属对话域（随 ui 一起从 session 搬来）。
import { provideConversationServer } from "@morlay/dsh-conversation/server";
import {
  provideSessionPersistence,
  SessionPersistenceDefault,
} from "@morlay/dsh-session-persistence";
import { SessionQuerySqlite } from "@morlay/dsh-session";
import { SessionPersistenceRdb } from "@morlay/better-session";
import { provideBetterSession } from "@morlay/better-session/server";
import { provideSessionMode, provideSessionModeEndpoints } from "@morlay/session-mode";
import { UiSettingsPreferences, UiThemeSchema } from "@morlay/zephyr-app";
import { provideSessionTitle, provideSessionTitleLlm } from "@morlay/dsh-conversation/server";
import { provideLlmProviders } from "@morlay/dsh-agent";
import { LlmPiAi } from "@morlay/dsh-agent";
import { provideSetting } from "@morlay/dsh-setting/server";
import { provideShell, provideTerminal } from "@morlay/dsh-shell/server";
import { provideSkill, SkillCatalogRow } from "@morlay/dsh-skill/server";
import { StorageDomainDefault, provideStorage } from "@morlay/dsh-storage";
import { provideAgentUse } from "@morlay/agent-use";
import { provideAgentTeam } from "@morlay/dsh-agent-team/server";
import { provideDeliverables } from "@morlay/dsh-conversation/server";
import { provideUpload } from "@morlay/dsh-upload/server";
import { provideToolWeb, provideWebAccess } from "@morlay/dsh-web-access/server";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { WorkingDirectoryDefault } from "@morlay/dsh-agent";
import { provideWorkingDirectory } from "@morlay/dsh-agent/server";
import { resolve } from "node:path";

/**
 * 装配根：**由部署值给**（`CliMode.workspace`），不读 `process.cwd()`。
 *
 * dev 形态它指向应用工作区；打包形态指向 `Resources/runtime`（闭包）。两个形态的差别就只有这一个
 * 目录与数据根——这正是 `AppEnv` 存在的理由。
 */
let appRoot = process.cwd();

/**
 * 部署参数：目前只有一个可覆盖项——数据根。
 *
 * 默认是 `<cwd>/.dsh-store`（`just custom web` 在 app 目录跑）。**测试要传 tmpdir**：
 * 会话库、设置文档、凭据都落在它下面，指到真实目录就会在别人的开发库上读写
 * （实测过一次：测试把仓库里的 `.dsh-store` 写成了 2.6G 并清掉了一份真数据）。
 */
export interface CustomProvidersOptions {
  /** 装配根（工作区）。省略即 `process.cwd()`（单跑脚本时的兜底）。 */
  readonly workspace?: string;
  /** 数据根。省略即 `<装配根>/.dsh-store`。 */
  readonly dataDir?: string;
}

// 路径只在装配面算一次：`AppEnv.dataDir` 与各层的子目录都从它拼，避免两处硬编码漂移。
function dataDirOf(options: CustomProvidersOptions): string {
  return options.dataDir ?? resolve(appRoot, ".dsh-store");
}
// 权限档位也只在这里读一次：它同时写沙箱模式与批准策略两个开关。
const permissionMode = (process.env.DSH_PERMISSION_MODE ?? "workspace-write") as PermissionMode;

/**
 * 入口清单：每组是一个装配单元，按依赖顺序（提供方在前）拼起来。
 * @param options - 部署参数（目前只有 `dataDir`；测试传 tmpdir）。
 * @returns 完整的 provider 清单。
 */
export function customProvidersOf(options: CustomProvidersOptions = {}): ProviderEntry[] {
  // 装配根只在这里落一次：下面读 `appRoot` 的地方（AppEnv、sandbox、workingDirectory）都拿它。
  appRoot = options.workspace ?? appRoot;
  const dataDir = dataDirOf(options);
  return [
    // 认凭据的行放在最前：`connection` 行 mount 时就要 `Credentials` 的**面**（适配行的面在它自己的
    // mount 之后才绑上，排在后面就会拿到空壳——症状是 `credentials.modifyRecord is not a function`）。
    ...credentialsProviders(),
    ...frameworkProviders(),
    // 存储 hub 要排在会话域之前：会话的投影缓存 `onInit` 里就 `open` storage domain。
    ...storageProviders(dataDir),
    // 会话的**核心**行（store / 投影 / 查询 / 持久化 / 缓存 / 计量）：agent 域要它们的面。
    // 落盘的默认路径也从 `dataDir` 派生（`<dataDir>/sessions/sessions.sqlite`），见 `sessionCoreProviders`。
    ...sessionCoreProviders(dataDir),
    // agent 核心排在配置域之前：配置里的 LLM provider 行要 `Llm` 的面。
    ...agentProviders(),
    // 会话模式与注入面：模式定义、按会话收口（工具 / 技能 / policy / 三个注入开关）、PTC 骨架替换，
    // 以及子代理那两处中文文案的接管。它要 `AgentDirectory` 与 `SessionStore` / `SessionProjectionStore`，
    // 所以排在会话核心与 agent 域之后。
    ...provideSessionMode(),
    // wire 面：`sessionMode/*` 端点行（headless 清单不含它）。
    ...provideSessionModeEndpoints(),
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
    ...deploymentProviders(dataDir),
  ];
}

/**
 * framework 链：宿主与前端面（`@morlay/zephyr-app`）。
 * @returns provider 条目。
 */
function frameworkProviders(): ProviderEntry[] {
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
    // **预构建的开关与范围归 Federation**：形态只决定"哪些包当文件走 vite"，不影响功能。
    ...provideClientModules(
      configure(FederationDefault, {
        // **只有这一个开关**：打包形态（`ZEPHYR_DESKTOP_PACKAGED=1`）把名单清空 = 全部预构建；
        // 其余形态只把 `@morlay/*` 当文件走 vite（改它们靠 HMR）。功能不受影响。
        dev: {
          include: process.env.ZEPHYR_DESKTOP_PACKAGED === "1" ? [] : ["@morlay/*"],
        },
      }),
    ),
  ];
}

/**
 * 会话域的核心行：存储 / 投影 / 查询 / 持久化 / 缓存 / 计量 / 检查点 / 宿主表。
 *
 * 下游（agent 域、配置域的 LLM 行）都按这里的面注入，所以它们必须在这一层全就位。
 */
function sessionCoreProviders(dataDir: string): ProviderEntry[] {
  return [
    // 落盘换成 RDB（`@morlay/better-session` 的实现）：官方 jsonl 那一行用 `without` 剔掉，
    // 同名的 `SessionPersistence` 服务由 RDB 实现接管。替换的是**实现**，契约与消费方都不动。
    // 库路径显式给：默认值虽然也从 `AppEnv.dataDir` 派生，但装配面把它写死在这里，
    // 读的人一眼能看到"会话库在哪"（测试传 tmpdir 时也就自动跟着走）。
    ...provideSessionPersistence(without(SessionPersistenceDefault)),
    ...provideBetterSession(
      configure(SessionPersistenceRdb, {
        type: "sqlite",
        path: resolve(dataDir, "sessions", "sessions.sqlite"),
      }),
    ),
    // 投影检查点**不装**官方的 KV 版（`provideSessionProjectionCache()`）：`provideBetterSession` 里的
    // RDB 版同名接管（`sessionProjectionCache`），两者同时装会抛
    // `service "sessionProjectionCache" has been registered`。检查点必须与会话日志同库同事务，
    // 撤回时才能按水位截断；KV 版是 json 后端时代的第二条写路径。
    ...provideTokenMeter(),
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
  return [...provideSessionTitle(), ...provideSessionTitleLlm()];
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
  ];
}

/**
 * 存储：hub 与 domain 行在前，**后端行在后**（后端在自己的 `onInit` 里 `ctx.storage.backend.register`，
 * 要求 hub 已就位；domain 是惰性的，第一次 `open` 时才查后端，所以它可以先挂）。
 */
function storageProviders(_dataDir: string): ProviderEntry[] {
  return [
    // KV 域路由到 **rdb**（`@morlay/better-session` 注册的那个后端）：会话落盘与 KV 域同一个库，
    // 事务能跨着用，`<dataDir>/storages/*.json` 也不会再被创建。
    // **不装 json 后端**（`provideStorageJson`）：装了会多一个没人路由的 `storages/` 目录。
    ...provideStorage(configure(StorageDomainDefault, { backend: "rdb" })),
  ];
}

/**
 * 环境面：ptc / 附件 / 浏览器与桌面操作。
 *
 * `provideAgentUse()` 是两条 MCP 客户端行（`agent-browser mcp` / `agent-desktop mcp`）：它们只要
 * `tools` 服务，命令找不到时照常激活、只是不产出工具（上游默认 `failOnStartupError: false`）。
 */
function environmentProviders(): ProviderEntry[] {
  return [
    ...providePtc(),
    ...provideAttachment(),
    ...provideAgentUse(),
    // 交付物：工作区变更的数据源 + `/api/present.host` 那四条路由。
    // 路由行要 `connection`（zephyr-app）/ `sessionQuery` / `sessionController` / `workspaceFiles` /
    // `fs` / `sandboxPolicy` / `workspaceChanges`——前六件在本函数的同级或更早各组里，所以排在这里。
    ...provideDeliverables(),
  ];
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
  // 试验：三段合成一次调用（放在装配后段）。
  return [...provideConversationServer(without(SessionQuerySqlite))];
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
    // 设置机制先装：provider 行的 `onInit` 要往 `SettingSchema` 里注册自己的 schema。
    ...provideSetting(),
    // feature 叠在 `provideLlmProviders()` 的清单上（第二个参数是 feature 列表），与 `provideXxx(configure(...))`
    // 是同一套写法——装配面只给差异值，默认值仍由上游 schema 补。
    ...provideLlmProviders(
      configure(LlmPiAi, {
        providers: {
          ollama: {
            // 走凭证服务读 `OLLAMA_API_KEY`（别把密钥写进配置）。
            apiKeyEnv: "OLLAMA_API_KEY",
            displayName: "Ollama Cloud",
            api: "anthropic-messages",
            baseURL: "https://ollama.com",
            // 与 `apiKeyEnv` 同一个 key：`apiKeyEnv` 决定"用哪个凭证"，这一条是把它带进请求头。
            headers: {
              Authorization:
                process.env.OLLAMA_API_KEY === undefined
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
      }),
    ),
    // 两个**具体设置项**由框架层注册（机制也在那里）：主题的 durable schema 与「开发者工具」偏好。
    UiThemeSchema,
    UiSettingsPreferences,
  ];
}

/** agent 核心：目录 / 模型 / 工具注册表 / 循环 / 命令 / 子代理。 */
function agentProviders(): ProviderEntry[] {
  return [
    // 执行器只有一个：本部署选 PTC（`providePtc()` 那一行把执行器装成根作用域的部署默认），
    // 上游的 native 行与之在同一个 scope 上互斥（`setExecutor` 抛 "Only one tool executor may be
    // registered in each scope"），所以在这里剔掉。执行器选择的语义归 `@morlay/dsh-agent-loop`。
    ...provideAgent(),
    ...provideCommand(),
    // 执行器只有一个：本部署选 PTC，剔掉 native 那条。
    ...provideAgentLoop(without(ToolExecutorNative)),
    // Agent Teams：团队服务（`agentTeams`）+ 它那套工具（`spawn_teammate` / `team_task_*` …）。
    // 它要 `subagents` 服务，所以排在 `provideSubagent()` 之后；上游普通 `subagent` / `subagent_fork`
    // **不禁**——两套并存由这个装配面决定（上游那套 profile 会禁掉它们换 Team，本部署不跟）。
    ...provideAgentTeam(),
  ];
}

/** 任务面：job。 */
function taskProviders(): ProviderEntry[] {
  return [...provideJob()];
}

/** 工作区 / 目录选择（host 面）。 */
function workspaceProviders(): ProviderEntry[] {
  return [
    ...provideWorkspace(),
    // `remote.workspaceFiles` 的宿主面（上游 `WorkspaceFiles` + 五条端点）：要沙箱策略与会话/持久化，
    // 所以由装配面显式装上，不塞进 `provideSandbox()`。
    ...provideWorkspaceFiles(),
  ];
}

/** 工具面：环境工具 / 工具策略 / web 访问 / 遥测 / `llm/*` 的 wire 行。 */
function toolProviders(): ProviderEntry[] {
  return [
    // 工具行按能力域分装：`bash` 在 shell 域，文件/检索/工作目录在 agent。
    ...provideFsTools(),
    ...provideEnvTools(),
    ...provideWebAccess(),
    ...provideToolWeb(),
    // `llm/*` 的 wire 面：由 agent 域的 `provideLlmRemote()` 出（顺便登记它的 remote 面）。
    ...provideLlmRemote(),
  ];
}

/**
 * 需要部署值的域 + 本应用自己的 Provider（路径与档位只在这一处给，包内只留默认值）。
 * @returns provider 清单。
 */
function deploymentProviders(dataDir: string): ProviderEntry[] {
  return [
    ...provideShell(),
    ...provideSandbox(
      configure(SandboxPolicyDefault, { mode: permissionMode, workspaceRoot: appRoot }),
    ),
    ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: appRoot })),
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
      }),
    ),
  ];
}

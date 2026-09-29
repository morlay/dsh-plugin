// 探针：装配一次真实 web profile，检查**我们自己注册的那份 agent preset** 在真部署里给了两个模式什么。
//
// 包内测试（`packages/profile/dsh-session-mode/src/__tests__/preset-plane.spec.ts`）用真 registry + 真上游行
// 验了同一件事，但它只取要验的那几行；**整条行清单**能不能在真部署里装起来（每个 host 服务都在场：压缩要
// tokenMeter、委派要 subagents、shell 要 jobs…）只有真装配回答得了。这里回答的五件事：
//
// 1. 新会话默认挂 `mode-switch`（`agent-preset-registry` 的默认值由配置层给），模式事实是 `coding`；
// 2. `coding` 的模型目录是**全套**：文件 / Shell / 委派 / workflow / todo / goal / present / 联网 / skill /
// 计划模式（`exit_plan_mode`，进计划模式后 `plan:policy` 规则段是我们的中文契约）；
// 3. `chat` 的目录被收口到三件：`ask_user_question` / `web_search` / `web_fetch`（复用时一个都不在的那个问题）；
// 4. 注入面：`chat` 0 条；`coding` 只有**我们那一份**技能目录（kind `context-assembler`）与工作区指令；
// 5. 切模式（chip 在 `coding` ↔ `chat` 间来回）**不重挂 preset**；显式去官方 roster 选 `standard` 时才重挂，
// 且工作区指令让位给上游那一行、skill 面仍是我们抢到的那份。
//
// 用法（脚本住 `@morlay/dsh-desktop-host/tool/`：只有那个包声明了 `dsh-app-boot` / `dsh`，node 才解析得到）：
//
// ```sh
// pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-preset-plane.mts
// ```
//
// 前提：`apps/dsh-custom-next/.dsh-store/profiles/web` 已被 desktopify 准备过（跑过一次 `just custom dev --web`
// 或 `just custom desktop`）。脚本会**建一个空白会话**（用来切模式）——它们落在那个 dev store 里
// （`.dsh-store/` 已被 gitignore），不碰别的会话。

import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLayeredEnv,
  loadProfileDirectory,
  reportSkippedBundles,
} from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";

const PORT = 3099;
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const store = join(repoRoot, "apps/dsh-custom-next/.dsh-store");
const profileDir = join(store, "profiles", "web");
const installAnchor = join(repoRoot, "vendor/deepseek-harness/apps/cli/package.json");

const MODE_PRESET = "mode-switch";
const UPSTREAM_INSTRUCTIONS_MODULE = "@deepseek-ai/dsh-agent-instructions";
// `chat` 的三件：白名单收口之后目录里应当只剩它们。
const CHAT_TOOLS = ["ask_user_question", "web_fetch", "web_search"];
// `coding` 的目录里应当有的代表：文件、Shell、委派、workflow、flow、联网、skill。
const CODING_TOOLS = [
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "bash",
  "job_list",
  "subagent",
  "subagent_fork",
  "workflow",
  "todo_write",
  "create_goal",
  "present",
  "web_search",
  "web_fetch",
  "ask_user_question",
  "skill",
  // 计划模式：官方 `standard` 的 `planning` 组给的那件（`coding` 不能丢）。
  "exit_plan_mode",
];

// `contextAssembler.collect()` 的一条注入：正文 + 对外身份（`source`）。
interface AssistantMessage {
  readonly text?: string;
  readonly source?: { readonly id?: unknown; readonly kind?: unknown };
}

interface ProbeServices {
  readonly agentPresets:
    | {
        readonly defaultId: string;
        list(): Promise<readonly { id: string; name?: string; broken?: string }[]>;
        composedPreset(ctx: unknown): string | undefined;
        compositionInventory(): Promise<
          readonly {
            id: string;
            isMounted?: boolean;
            rows: readonly { moduleName: string; enabled: boolean | string }[];
          }[]
        >;
        select(agent: unknown, id: string): Promise<string>;
        recompose(ctx: unknown, id: string): Promise<unknown>;
        // 读 preset realm 里的服务（`isolate` 之后的 `planMode` 只有这条路读得到）。
        serviceFor(agent: { ctx: unknown }, name: string): unknown;
      }
    | undefined;
  readonly sessionController:
    | {
        create(request: {
          sessionId: string;
          cwd?: string;
          agentPreset?: string;
        }): Promise<{ sessionId: string; agentPreset?: string }>;
      }
    | undefined;
  readonly agents:
    | {
        create(options: {
          sessionId: string;
          meta: { cwd: string };
          setup?: unknown;
        }): Promise<{ agent: AgentLike }>;
        get(id: string): AgentLike | undefined;
      }
    | undefined;
  readonly sessions: { get(id: string): SessionLike | undefined } | undefined;
  readonly systemPrompt:
    | { assemble(context: unknown): Promise<{ tools: readonly { name: string }[] }> }
    | undefined;
  readonly contextAssembler:
    | { collect(agent: unknown): Promise<Map<string, AssistantMessage>> }
    | undefined;
  readonly sessionModes:
    | {
        modeOf(session: unknown): string;
        select(sessionId: string, mode: string): Promise<string>;
        roster(): { default: string; modes: readonly { id: string; name: string }[] };
      }
    | undefined;
}

interface AgentLike {
  readonly id: string;
  readonly ctx: unknown;
  readonly session: SessionLike;
}

interface SessionLike {
  readonly id: string;
  readonly header: { readonly cwd?: string };
}

const profileReady = await access(join(profileDir, "package.json")).then(
  () => true,
  () => false,
);
if (!profileReady) {
  console.error(
    `verify-preset-plane: 没有可用的 web profile（${profileDir}）——先跑一次 ` +
      "`just custom dev --web` 或 `just custom desktop` 让 desktopify 准备好它",
  );
  process.exit(2);
}

process.env.DSH_HOME = store;

const profile = loadProfileDirectory("dsh", profileDir, installAnchor);
reportSkippedBundles("dsh", profile);

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv("dsh"),
  profile: "web",
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: ["--no-open", "--port", String(PORT)],
});

// 服务读面：cordis 的属性访问要求当前 fiber 声明过注入，所以这里先试 `ctx.get(name)`（它不需要声明），
// 拿不到再退回属性（服务就在根 store 上的情形）。
function serviceOf<K extends keyof ProbeServices>(name: K): ProbeServices[K] | undefined {
  try {
    const got = (ctx as unknown as { get(name: string): unknown }).get(name);
    if (got !== undefined) return got as ProbeServices[K];
  } catch {
    // 没装这一行的部署（或当前 ctx 看不到它）：退回属性读法。
  }
  return (ctx as unknown as Record<string, ProbeServices[K] | undefined>)[name];
}

const services: ProbeServices = {
  get agentPresets() {
    return serviceOf("agentPresets");
  },
  get sessionController() {
    return serviceOf("sessionController");
  },
  get agents() {
    return serviceOf("agents");
  },
  get sessions() {
    return serviceOf("sessions");
  },
  get systemPrompt() {
    return serviceOf("systemPrompt");
  },
  get contextAssembler() {
    return serviceOf("contextAssembler");
  },
  get sessionModes() {
    return serviceOf("sessionModes");
  },
};
const failures: string[] = [];

function check(ok: boolean, message: string): void {
  console.log(`verify-preset-plane: ${ok ? "✓" : "✗"} ${message}`);
  if (!ok) failures.push(message);
}

// 模型目录：装配一次（收口挂在 `system-prompt/assemble` 上），取工具名。
async function catalogOf(agent: AgentLike): Promise<string[]> {
  const assembly = await services.systemPrompt?.assemble({ agent, scope: agent });
  return (assembly?.tools ?? []).map((tool) => tool.name).toSorted();
}

// 本步要注入的条目 id（`source.id` 是通道的幂等键；上游那几条没有它）。
async function injectionsOf(agent: AgentLike): Promise<Map<string, AssistantMessage>> {
  return (await services.contextAssembler?.collect(agent)) ?? new Map();
}

function kindOf(entry: AssistantMessage | undefined): string {
  const kind = entry?.source?.kind;
  return typeof kind === "string" ? kind : "";
}

function textOf(entry: AssistantMessage | undefined): string {
  return entry?.text ?? "";
}

// 通道的规则是 `agent/created` 里的异步安装：等到那条工作区指令的规则真的出现在注入里。
async function untilInstructions(agent: AgentLike): Promise<Map<string, AssistantMessage>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const entries = await injectionsOf(agent);
    if ([...entries.keys()].some((id) => id.startsWith("agent-instructions:"))) return entries;
    await new Promise((settle) => setTimeout(settle, 50));
  }
  return await injectionsOf(agent);
}

// 建一个空白会话：走 `sessionController.create`（真路径——它按 registry 的默认 preset 解析并挂上）。
async function createSession(label: string): Promise<{ agent: AgentLike; agentPreset?: string }> {
  const controller = services.sessionController;
  if (controller === undefined) throw new Error("session-controller 没装上");
  const created = await controller.create({
    sessionId: `probe-preset-plane-${label}-${String(Date.now())}`,
    cwd: repoRoot,
  });
  const agent = services.agents?.get(created.sessionId);
  if (agent === undefined) throw new Error(`会话 ${label} 建起来了但 agent 不在注册表里`);
  return {
    agent,
    ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }),
  };
}

// registry：默认 preset、行清单、`serviceFor`（读 preset realm 里的服务）与 `recompose` 计数都经它。
const registry = services.agentPresets;

// ── 1. 默认挂我们那份 ────────────────────────────────────────────────────────────────────────────

const roster = await services.agentPresets?.list();
console.log(
  `verify-preset-plane: preset 名册 — ${(roster ?? [])
    .map((preset) => `${preset.id}${preset.name === undefined ? "" : `（${preset.name}）`}`)
    .join(", ")}`,
);
check(services.agentPresets?.defaultId === MODE_PRESET, `registry 默认是 ${MODE_PRESET}`);
check(
  (roster ?? []).some((preset) => preset.id === MODE_PRESET && preset.broken === undefined),
  `${MODE_PRESET} 在名册里且装配成功`,
);
const inventory = await services.agentPresets?.compositionInventory();
const ours = (inventory ?? []).find((entry) => entry.id === MODE_PRESET);
console.log(
  `verify-preset-plane: ${MODE_PRESET} 的行（${String(ours?.rows.length ?? 0)} 行）— ` +
    (ours?.rows.map((row) => row.moduleName).join(", ") ?? "(缺失)"),
);
const ourModules = new Set((ours?.rows ?? []).map((row) => row.moduleName));
for (const module of ["@deepseek-ai/dsh-tool-web", "@deepseek-ai/dsh-skill-filesystem"]) {
  check(ourModules.has(module), `${MODE_PRESET} 的行清单里有 ${module}`);
}
for (const module of [
  UPSTREAM_INSTRUCTIONS_MODULE,
  "@deepseek-ai/dsh-tool-skill",
  "@morlay/dsh-agent-toolkit/guidance",
]) {
  check(!ourModules.has(module), `${MODE_PRESET} 的行清单里没有 ${module}（注入面归 host 平面）`);
}

const created = await createSession("main");
const agent = created.agent;
check(
  created.agentPreset === MODE_PRESET &&
    services.agentPresets?.composedPreset(agent.ctx) === MODE_PRESET,
  "新会话挂的是我们那份 preset（session-controller 解析出来的就是它）",
);
check(
  services.sessionModes?.modeOf(agent.session) === "coding",
  "新会话的模式是 coding（部署默认）",
);

// ── 2. coding：全套目录 + 一份自己的注入 ─────────────────────────────────────────────────────────

const codingTools = await catalogOf(agent);
console.log(
  `verify-preset-plane: coding 目录（${String(codingTools.length)} 件）— ${codingTools.join(", ")}`,
);
for (const tool of CODING_TOOLS) check(codingTools.includes(tool), `coding 目录里有 ${tool}`);

const codingEntries = await untilInstructions(agent);
console.log(`verify-preset-plane: coding 注入 — ${[...codingEntries.keys()].join(", ") || "(无)"}`);
const codingCatalogs = [...codingEntries].filter(
  ([id, entry]) => id === "skill-catalog" || kindOf(entry) === "skill-catalog",
);
check(codingCatalogs.length === 1, "coding 只有一份技能目录");
check(
  kindOf(codingCatalogs[0]?.[1]) === "context-assembler",
  "技能目录的 kind 是 context-assembler（我们发布的那份）",
);
check(
  [...codingEntries.keys()].some((id) => id.startsWith("agent-instructions:")),
  "coding 的工作区指令由我们注入",
);

// ── 2b. 计划模式：规则段是我们自己那份中文契约 ──────────────────────────────────────────────────

// `planning` 组带 `isolate: { planMode: true }`：服务在 preset realm 里，host 侧要经 registry 的
// `serviceFor` 读（这也是上游给"读某个会话的 preset 服务"留的接面）。
interface PlanModeLike {
  set(agent: unknown, active: boolean): string;
  get(agent: unknown): { active: boolean };
}
const planMode = registry?.serviceFor(agent, "planMode") as PlanModeLike | undefined;
check(planMode !== undefined, "planMode 服务在会话的 preset realm 里（计划模式的行装上了）");
const entered = planMode?.set(agent, true);
console.log(`verify-preset-plane: 进入计划模式 — ${entered ?? "(服务缺失)"}`);
check((await catalogOf(agent)).includes("exit_plan_mode"), "coding 目录里有 exit_plan_mode");
const planEntries = await injectionsOf(agent);
const policy = textOf(planEntries.get("section:plan:policy"));
console.log(`verify-preset-plane: 计划模式注入 — ${[...planEntries.keys()].join(", ") || "(无)"}`);
check(policy.length > 0, "计划模式下注入了 plan:policy 规则段");
check(policy.includes("exit_plan_mode"), "规则段是我们自己那份中文契约（提到 exit_plan_mode）");
check(policy.includes("不要做任何写操作"), "规则段守住了只读探索这条约束");
planMode?.set(agent, false);
check(planMode?.get(agent).active === false, "退出计划模式（后面的判据不受它影响）");

// ── 3. chat：三件工具 + 注入 0 条 + 不重挂 preset ────────────────────────────────────────────────

const recomposes: string[] = [];
if (registry !== undefined) {
  const recompose = registry.recompose.bind(registry);
  registry.recompose = (agentCtx: unknown, id: string) => {
    recomposes.push(id);
    return recompose(agentCtx, id);
  };
}

await services.sessionModes?.select(agent.id, "chat");
const chatTools = await catalogOf(agent);
console.log(`verify-preset-plane: chat 目录 — ${chatTools.join(", ")}`);
check(chatTools.join(",") === CHAT_TOOLS.join(","), `chat 目录正好是 ${CHAT_TOOLS.join(" / ")}`);
check((await injectionsOf(agent)).size === 0, "chat 注入 0 条（instructions: false）");
check(recomposes.length === 0, "切到 chat 没有重挂 preset（目标 preset 与当前相同）");

await services.sessionModes?.select(agent.id, "coding");
check(recomposes.length === 0, "切回 coding 也没有重挂 preset");
check((await catalogOf(agent)).length === codingTools.length, "回到 coding 目录与切走之前一致");

// ── 4. 官方 preset 的会话照旧：让位 + skill 面归我们 ─────────────────────────────────────────────

await registry?.select(agent, "standard");
check(recomposes.length === 1, "显式选官方 standard 才重挂一次 preset");
check(services.agentPresets?.composedPreset(agent.ctx) === "standard", "会话现在挂在 standard 上");
const standardEntries = await injectionsOf(agent);
console.log(
  `verify-preset-plane: standard 注入 — ${[...standardEntries.keys()].join(", ") || "(无)"}`,
);
check(
  ![...standardEntries.keys()].some((id) => id.startsWith("agent-instructions:")),
  "standard 会话里我们让位：工作区指令不由通道注入（由上游那一行给）",
);
const standardCatalogs = [...standardEntries].filter(
  ([id, entry]) => id === "skill-catalog" || kindOf(entry) === "skill-catalog",
);
check(standardCatalogs.length === 1, "standard 会话里技能目录仍只有一份");
check(
  kindOf(standardCatalogs[0]?.[1]) === "context-assembler",
  "standard 会话的技能目录还是我们抢到的那份",
);
console.log(
  `verify-preset-plane: standard 目录里 skill 工具 — ${
    (await catalogOf(agent)).includes("skill") ? "在" : "不在"
  }`,
);
check(textOf(standardCatalogs[0]?.[1]).length > 0, "技能目录正文非空");

await shutdown.shutdown(failures.length === 0 ? 0 : 1);
for (const failure of failures) console.error(`verify-preset-plane: ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);

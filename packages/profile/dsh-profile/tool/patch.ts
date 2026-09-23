import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";

/**
 * bundle patch 的内容：**配置初始化**——按 id 给行配值（`config` 覆盖）或按 id 关掉部署不要的行，**一行都不插**。
 *
 * 这里放的都是"所有模式理应一致"的部署事实：llm 路由、默认模型、界面语言与对话视图、欢迎提示版本、
 * 搜索后端的选择与 key 引用、沙箱规则的**值**，以及**关掉官方 agent preset 那一整套**
 * （`agent-preset-registry`、`ui-agent-preset`、四个 shipped preset 行）与**先读后改**
 * （`fs-observation-policy`：本部署不要这个前置检查）。
 *
 * 装配（插行 / 禁官方行）是各能力包自己的 bundle 的事：官方 `sandbox` / `fs-sandbox` 两行由
 * `@morlay/dsh-sandbox-local` 的 patch 禁用并插入自己，搜索后端的注册行由
 * `@morlay/dsh-web-search-ollama` 的 patch 插入。patch 层按 `dsh.profile.bundles` 顺序叠加，所以 app 的
 * bundles 列表把这两个包排在本包**之前**——本包的 config 覆盖才找得到它们插的行。
 *
 * `profiles/<name>/cordis.patch.yml`（profile 的用户层）在**每个 bundle 层之后**应用，所以用户改设置
 * 仍然压得住这里：本层给的是默认值，不是锁。
 *
 * 会话模式（coding / chat）也不在这里：它们由 `@morlay/dsh-session-mode` 的 `config.modes` 声明。
 *
 * 这里是生成物的真源：`cordis.patch.yml` 由 `renderPatch()` 写出，改动请改这份 TS，
 * 一致性由 `patch.spec.ts` 的断言兜住。
 */

/** 沙箱规则：`rw <path>` 追加工作区之外的可写根，`-- <pattern>` 拒绝访问（读 + 写）。 */
const SANDBOX_ACCESS = [
  "rw /tmp",
  "rw {{ env.XDG_CACHE_HOME }}",
  "rw {{ env.XDG_STATE_HOME }}",
  "rw {{ env.XDG_DATA_HOME }}",
  "r- {{ env.XDG_CONFIG_HOME }}",
  "-- mise.*.toml",
  "-- **/*.pem",
].join("\n");

export const PATCH_ROWS: readonly Record<string, unknown>[] = [
  {
    id: "llm-pi-ai",
    config: {
      providers: {
        ollama: {
          apiKeyEnv: "OLLAMA_API_KEY",
          displayName: "Ollama Cloud",
          api: "openai-completions",
          baseURL: "https://ollama.com/v1",
          reasoning: "high",
          // 图片上限按 llm-deepseek 的默认对齐：内联预算（20 MiB）、像素预算（2048²）两边本来就同值，
          // 只有"每张请求版本的原始字节目标"不同——llm-deepseek 是 2 MiB，pi-ai 默认 1 MiB。
          requestImageMaxBytes: 2 * 1024 * 1024,
          models: [
            {
              id: "deepseek-v4.1-flash",
              name: "DeepSeek V4.1 Flash @ Ollama Cloud",
              contextWindow: 1000000,
              input: ["text", "image"],
              reasoningEfforts: {
                off: null,
                low: "low",
                high: "high",
                max: "max",
              },
            },
          ],
        },
      },
    },
  },
  // 首次引导（欢迎提示）在本部署里预置成"已确认"：桌面形态的 client 加载的是自定义 scheme、不是 loopback，
  // 而上游 `ui-settings/src/client/index.ts` 按 `ctx.remote.$host.isLoopback` 决定 settings 的持久化模式——
  // 非 loopback 一律 `memory`，于是"确认过"只存在当前页面进程里，**每次打开都弹**。在 host 侧把该值预置成
  // 当前版本，client 一读就是已确认，与持久化模式无关；上游 bump 版本时值不再相等，会照常再弹一次（符合语义）。
  // 值与上游 `WELCOME_NOTICE_VERSION` 必须一致，`patch.spec.ts` 直接读那个常量比对，bump 后会红。
  {
    id: "ui-settings-general",
    config: { welcomeNoticeVersion: "2026-08-13.1" },
  },
  // 沙箱规则（配置初始化的那一半）：行由 `@morlay/dsh-sandbox-local` 的 bundle 插（它自己禁官方两行、
  // 插自己），这里只给值。`fs-observation-policy`（先读后改）仍不在这里禁用：它是模式取舍不是部署事实，
  // 想按模式关掉只能由那个模式自己抢在它的 waterfall 前面丢弃结果。
  { id: "sandbox-local", config: { access: SANDBOX_ACCESS } },
  {
    id: "web",
    // 一次只选一个 searchProvider：默认走本仓库的 `web-search-ollama` 行，key 与 llm route 共用
    // `OLLAMA_API_KEY`。**别改成"上游 deepseek 后端指向 ollama.com"**：真发一次
    // `POST https://ollama.com/v1/messages`（body 就是上游那一套 `tools:[{type:"web_search_20250305"}]`）
    // 只回 `stop_reason: tool_use` + `tool_use` 块——Ollama 把这个 server tool 降级成普通客户端工具、
    // 不自己执行搜索；上游 provider 只认服务端自执行后的 `web_search_tool_result` 块，于是报
    // WEB_PROVIDER_ERROR。Ollama 真正提供搜索的是它自己的 `POST /api/web_search`。
    // config 是整体替换、不是深合并——`fetchProvider` 必须跟着写全。
    config: { searchProvider: "ollama", fetchProvider: "http" },
  },
  // 搜索后端的 key 引用：注册行由 `@morlay/dsh-web-search-ollama` 的 bundle 插，这里只配值。
  { id: "web-search-ollama", config: { apiKeyEnv: "OLLAMA_API_KEY" } },
  // 界面语言、默认模型与对话视图：部署默认值（原先只活在 profile 的用户 patch 层里，新装机器拿不到，
  // 换机器也要手工抄）。用户层后应用，改设置仍然覆盖得住。
  { id: "locale", config: { preference: "zh" } },
  {
    id: "agent-default-model",
    config: { provider: "ollama", model: "deepseek-v4.1-flash", reasoningEffort: "high" },
  },
  { id: "ui-chat", config: { transcriptView: "expanded" } },
  // 关掉官方 agent preset 这一整套：host 侧的选择注册表、官方四个 shipped preset 行、客户端那三个面
  // （选择器 / 头部标签 / 设置页 roster）。我们的模式与它的选择面在 `@morlay/dsh-session-mode`：模式是一行
  // 数据，按会话应用。两套并行的模式机制留着只会互相打架——官方的每 revision 一棵 Loader 子树、还要
  // isolate realm。
  { id: "agent-preset-registry", disabled: true },
  { id: "ui-agent-preset", disabled: true },
  { id: "preset-standard", disabled: true },
  { id: "preset-ptc", disabled: true },
  { id: "preset-minimal", disabled: true },
  { id: "preset-cordis", disabled: true },
  // 先读后改（`fs-observation-policy`）直接禁掉：这是**部署级**取舍，本部署不做这个前置检查。原先那行
  // 按模式抵消的 `relax-intent` 随之退出（它只能抢 waterfall，代价是一条顺序敏感的行与一份归属判据）。
  { id: "fs-observation-policy", disabled: true },
];
// 这里**不再**按 id 禁用 `agent-instructions` / `tool-skill` / `skill-filesystem` / `office-to-pdf` 之类：
// 上游 web-app bundle 自己把前两面设在 preset 平面（`disabled: true`，注释写明「工具与目录由 preset 自己
// 挂」）；我们的那两面由 `@morlay/dsh-context-assembler`（工作区指令与 skill 目录）与
// `@morlay/dsh-agent-toolkit`（技能发现 provider）的 bundle 在 profile 平面挂，host 这份再禁一次是重复
// 动作；`office-to-pdf` 则回到上游原味（Sidebar 的 Office 预览标签页因此可用）。同理不再覆盖
// `system-prompt` 的 `includeHarnessIdentity` / `includeRuntimeContext`：那是所有会话共享的部署偏好，
// 按会话改提示词走模式自己的 persona（注册到该 agent 的 scope 上）。

export const PATCH_FILE = "cordis.patch.yml";

const HEADER = `# 本文件由 packages/profile/dsh-profile/tool/patch.ts 生成，请勿手工编辑
`;

export function renderPatch(): string {
  const body = yaml.dump([...PATCH_ROWS], {
    schema: entryListSchema,
    lineWidth: -1,
    quotingType: '"',
  });
  return `${HEADER}${body}`;
}

/** 把 bundle patch 落到包根：它是发布产物的一部分（`files` 里有它，装配按出口解析）。 */
export async function generatePatch(): Promise<string> {
  const path = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), PATCH_FILE);
  await writeFile(path, renderPatch());
  return path;
}

/**
 * tsdown 的 `build:done` 钩子：每次构建重写 `cordis.patch.yml`，入库的那份因此永远等于
 * `PATCH_ROWS`（`patch.spec.ts` 比对文件与 `renderPatch()`）。
 */
export function patchHooks(): { "build:done": () => Promise<void> } {
  return {
    "build:done": async () => {
      process.stdout.write(`generated ${await generatePatch()}\n`);
    },
  };
}

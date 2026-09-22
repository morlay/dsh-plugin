import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { PRESET_SOURCES, type PresetSource } from "./presets/index.ts";

/**
 * bundle patch 的行清单：**只放全局通用的装配**（与具体模式无关的东西）。
 *
 * 与模式相关的行（工具、注入、用法分组、persona）在 [presets/](./presets/index.ts) 里，由
 * `@deepseek-ai/dsh-agent-preset` 行的 `config.plugins` 承载——patch 作用于全部 preset，
 * 放进去就等于强迫 chat 也装。
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

/**
 * 一个 preset 就是一行的 `config.plugins`（上游 `@deepseek-ai/dsh-agent-preset` 的声明式形态）：
 * 注册表不扫目录、不收路径，所以我们的模式只能以行出现在这份 patch 里。
 */
function presetRow(source: PresetSource): Record<string, unknown> {
  return {
    id: `preset-${source.id}`,
    name: "@deepseek-ai/dsh-agent-preset",
    config: {
      id: source.id,
      name: source.name,
      description: source.description,
      order: source.order,
      plugins: [...source.rows],
    },
  };
}

export const PATCH_ROWS: readonly Record<string, unknown>[] = [
  {
    id: "system-prompt",
    // persona 不在这里：它按模式给（presets/persona.ts 的 `persona` 行注册同名 section 遮蔽）。
    config: { includeHarnessIdentity: false, includeRuntimeContext: false },
  },
  {
    // 注册表只认 `default`：模式定义是别处的行（下面那批 preset 行），它自己既不扫描也不收路径。
    // 官方那四个 shipped preset 行（standard / ptc / minimal / cordis）**不动**：它们是各自 scope 里的
    // 完整 composition，与我们的模式并存、可选；default 仍指向我们的第一个模式。
    id: "agent-preset-registry",
    config: { default: PRESET_SOURCES[0]!.id },
  },
  {
    insert: PRESET_SOURCES.map(presetRow),
  },
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
              reasoningEfforts: { off: null, low: "low", high: "high", max: "max" },
            },
          ],
        },
      },
    },
  },
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
  // 这两行由 base bundle 插在 host 层，而 preset 只能覆盖 config、删不掉 host 行——接管它们必须在这里
  // 按 id 禁用：否则 host 的 `tool-skill` 会跟 context-skill-catalog 抢同一个 `skill` 工具，
  // 而 `agent-instructions` 会跟 context-agent-instructions 一起注入工作区指令。
  { id: "agent-instructions", disabled: true },
  { id: "tool-skill", disabled: true },
  { id: "sandbox", disabled: true },
  { id: "fs-sandbox", disabled: true },
  { id: "fs-observation-policy", disabled: true },
  { id: "office-to-pdf", disabled: true },
  { id: "subagent-model-selection-settings", disabled: true },
  {
    insert: [
      {
        id: "sandbox-local",
        name: "@morlay/dsh-sandbox-local",
        config: { access: SANDBOX_ACCESS },
      },
    ],
  },
  {
    // 注入通道：它发布进程全局服务 `ctx.contextAssembler`，未隔离就放进 preset 会被上游拒绝
    // （`Preset services require isolate realms`）。进 preset 的唯一一条路是把它关进 `isolate` 组，
    // 那样服务只在 preset/agent scope 可见——与它「注入的唯一通道、部署级一份」的定位相反，
    // 所以住 host 层：preset 里的注入方沿 scope 链向上解析即可拿到。
    insert: [{ id: "context-assembler", name: "@morlay/dsh-context-assembler" }],
  },
  {
    // 搜索后端：preset 是每个 agent 各挂一份，同一个 provider id 注册两次会撞
    // `WEB_DUPLICATE_PROVIDER`，所以注册行住 host 层（选哪个由 `web` 行的 searchProvider 决定）。
    insert: [
      {
        id: "web-search-ollama",
        name: "@morlay/dsh-web-search-ollama",
        config: { apiKeyEnv: "OLLAMA_API_KEY" },
      },
    ],
  },
];

export const PATCH_FILE = "cordis.patch.yml";

const HEADER = `# 本文件由 packages/preset/dsh-preset/tool/patch.ts 生成，请勿手工编辑
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

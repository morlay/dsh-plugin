import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { ENABLE_TOOLS_NAME, IGNORED_SECTIONS, TOOL_GROUPS } from "../groups.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PACKAGES = join(REPO, "vendor/deepseek-harness/packages");
const STANDARD_COMPOSITION = join(
  PACKAGES,
  "preset/agent-presets/presets/standard/agent.cordis.yml",
);

/**
 * 不在档位里的工具：这些行在 standard 装配里被禁用，或不是标准模式的模型可见工具。
 * 新增项必须写清理由，否则覆盖性断言会失败。
 */
const OUT_OF_SCOPE_TOOLS: readonly string[] = [];

/**
 * 不随工具隐藏的说明 section：与工具用法无关的部署级提示（plan 规则、文件引用、
 * MCP 资源清单等）。新增项必须写清理由，否则覆盖性断言会失败。
 */
const UNGATED_SECTIONS: readonly string[] = [
  "plan:policy",
  "context:file-reference",
  "mcp-resource-servers",
  // 保留但不遮蔽：ui-deliverables 的输出链接规范（文本由本插件在装配投影里换成中文）。
  "ui:deliverable-file-references",
];

/**
 * 部署会在装配时禁用的行 id。这是两处禁用的镜像：`dsh-preset` 的 `cordis.patch.yml`
 * （host 侧的 sandbox / office / 委派四行）与生成器的 `DELEGATION_ROW_IDS`（preset 层同一批委派行）。
 * 覆盖性扫描读的是**上游** composition，所以要在这里把它们排除，否则会要求为不存在的工具归组。
 */
const DEPLOYMENT_DISABLED_ROWS: readonly string[] = [
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-subagent",
  "tool-subagent-fork",
];

interface CompositionRow {
  name?: unknown;
  disabled?: unknown;
  config?: unknown;
}

interface Row {
  readonly packageName: string;
  readonly enabled: boolean;
  /** 装配行给出的动态工具名（`toolName:`），源码里没有这个字面量。 */
  readonly toolName?: string;
  /** 装配行是否要求「按会话限制子代理可用模型」——它决定工具注册在哪一层。 */
  readonly modelSelection: boolean;
}

/** 递归收集装配行；group 行的 config 是嵌套行数组。 */
function collectRows(value: unknown, rows: Row[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectRows(entry, rows);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const row = value as CompositionRow & { id?: unknown };
  const declared = typeof row.id === "string" && DEPLOYMENT_DISABLED_ROWS.includes(row.id);
  const enabled = row.disabled !== true && !declared;
  const config = row.config;
  const inline =
    typeof config === "object" && config !== null && !Array.isArray(config) ? config : undefined;
  const toolName = inline === undefined ? undefined : (inline as { toolName?: unknown }).toolName;
  if (typeof row.name === "string") {
    rows.push({
      packageName: row.name,
      enabled,
      modelSelection:
        (inline as { modelSelectionSettings?: unknown } | undefined)?.modelSelectionSettings ===
        true,
      ...(typeof toolName === "string" ? { toolName } : {}),
    });
  }
  collectRows(config, rows);
}

/** 从装配行取出源码目录名：`@deepseek-ai/dsh-tool-fs-search` → `tool-fs-search`。 */
function directoryName(packageName: string): string {
  const withoutSubpath = packageName.split("/").slice(0, 2).join("/");
  return withoutSubpath.replace(/^@deepseek-ai\/dsh-/, "").replace(/^@deepseek-ai\//, "");
}

async function packageDirectories(): Promise<string[]> {
  const directories: string[] = [];
  for (const group of await readdir(PACKAGES, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of await readdir(join(PACKAGES, group.name), { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(PACKAGES, group.name, entry.name));
    }
  }
  return directories;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

/** 取 `marker` 之后的第一个对象字面量，按花括号配平。 */
function objectBlocks(text: string, marker: string): string[] {
  const blocks: string[] = [];
  let cursor = text.indexOf(marker);
  while (cursor !== -1) {
    const brace = text.indexOf("{", cursor);
    if (brace === -1) break;
    let depth = 0;
    let end = text.length - 1;
    for (let index = brace; index < text.length; index += 1) {
      if (text[index] === "{") depth += 1;
      else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    blocks.push(text.slice(brace, end + 1));
    cursor = text.indexOf(marker, end);
  }
  return blocks;
}

function literalName(block: string): string | undefined {
  return /\bname:\s*['"]([^'"]+)['"]/.exec(block)?.[1];
}

async function inventory(directories: readonly string[]): Promise<{
  tools: Set<string>;
  sections: Set<string>;
}> {
  const tools = new Set<string>();
  const sections = new Set<string>();
  for (const directory of directories) {
    const sources = join(directory, "src");
    const reached = await stat(sources).then(
      () => true,
      () => false,
    );
    if (!reached) continue;
    for (const file of await sourceFiles(sources)) {
      const text = await readFile(file, "utf8");
      for (const block of objectBlocks(text, "defineTool(")) {
        const name = literalName(block);
        if (name !== undefined) tools.add(name);
      }
      for (const block of objectBlocks(text, "systemPrompt.section(")) {
        const name = literalName(block);
        if (name !== undefined) sections.add(name);
      }
    }
  }
  return { tools, sections };
}

/** standard 装配引用的包目录（跳过禁用的行）。 */
async function enabledDirectories(): Promise<string[]> {
  const rows: Row[] = [];
  collectRows(
    yaml.load(await readFile(STANDARD_COMPOSITION, "utf8"), { schema: entryListSchema }),
    rows,
  );
  const wanted = new Set(
    rows.filter((row) => row.enabled).map((row) => directoryName(row.packageName)),
  );
  return (await packageDirectories()).filter((directory) =>
    wanted.has(directory.split("/").at(-1)!),
  );
}

/** standard 装配里显式给出的动态工具名：源码扫描看不到这些字面量。 */
async function declaredToolNames(): Promise<string[]> {
  const rows: Row[] = [];
  collectRows(
    yaml.load(await readFile(STANDARD_COMPOSITION, "utf8"), { schema: entryListSchema }),
    rows,
  );
  return rows.flatMap((row) => (row.toolName === undefined || !row.enabled ? [] : [row.toolName]));
}

/**
 * 上游在 **agent 作用域**注册说明的写法（已知几种）。遮蔽它们会抛
 * "already registered in this scope"，让整场 session 创建失败——`team:policy` 就炸过一次。
 * 上游新增写法时把 marker 补进来；这份清单就是这条断言的全部价值所在。
 */
const AGENT_SCOPE_SECTION_MARKERS: readonly string[] = [
  "agent.ctx.systemPrompt.section(",
  "candidate.ctx.systemPrompt.section(",
  "childCtx.systemPrompt.section(",
  "scoped.systemPrompt.section(",
  "runtimeCtx.systemPrompt.section(",
];

/** 扫描全树，收集「注册在 agent 作用域」的说明 section 名。 */
async function agentScopedSectionNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const directory of await packageDirectories()) {
    const sources = join(directory, "src");
    const reached = await stat(sources).then(
      () => true,
      () => false,
    );
    if (!reached) continue;
    for (const file of await sourceFiles(sources)) {
      const text = await readFile(file, "utf8");
      for (const marker of AGENT_SCOPE_SECTION_MARKERS) {
        for (const block of objectBlocks(text, marker)) {
          const name = literalName(block);
          if (name !== undefined) names.add(name);
        }
      }
    }
  }
  return names;
}

/**
 * 条件性落在 agent 作用域的说明：装配行不开 `modelSelectionSettings` 时它们注册在 preset 层
 * （可遮蔽），而产物测试锁住了「不开」；一旦开了就会同层重名。
 */
const CONDITIONALLY_SCOPED_SECTIONS: readonly string[] = ["tool:subagent", "tool:subagent_fork"];

describe("覆盖性：标准模式的工具与说明都必须归组", () => {
  it("standard 装配引用的每个工具都在档位表或豁免表里", async () => {
    const { tools } = await inventory(await enabledDirectories());
    const known = new Set([
      ...TOOL_GROUPS.flatMap((group) => group.tools),
      ENABLE_TOOLS_NAME,
      ...OUT_OF_SCOPE_TOOLS,
    ]);

    expect(
      [...new Set([...tools, ...(await declaredToolNames())])]
        .filter((tool) => !known.has(tool))
        .sort(),
    ).toEqual([]);
  });

  it("standard 装配引用的每个工具说明 section 都在忽略清单或豁免表里", async () => {
    const { sections } = await inventory(await enabledDirectories());
    const known = new Set([...IGNORED_SECTIONS, ...UNGATED_SECTIONS]);

    expect([...sections].filter((section) => !known.has(section)).sort()).toEqual([]);
  });

  it("忽略清单不含上游按 agent 作用域注册的说明", async () => {
    // 在 agent 作用域注册同名空文本会抛 "already registered in this scope"，让整场 session 创建失败。
    const scoped = await agentScopedSectionNames();
    const risky = IGNORED_SECTIONS.filter(
      (name) => scoped.has(name) && !CONDITIONALLY_SCOPED_SECTIONS.includes(name),
    );

    expect(risky).toEqual([]);
  });
});

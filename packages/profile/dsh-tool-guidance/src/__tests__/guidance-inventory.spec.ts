import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPRESS } from "@morlay/dsh-context-assembler";
import { TOOL_GROUPS } from "../guidance/groups.ts";

// vitest 从仓库根跑（与其它读上游文件的 spec 同一约定），不用相对文件深度算。
const REPO = process.cwd();
const PACKAGES = join(REPO, "vendor/deepseek-harness/packages");
// 上游 shipped standard preset 的装配行：0.1.7 起 preset 是 `@deepseek-ai/dsh-agent-preset` 行
// （`config.plugins` 就是装配），住在 web-app bundle 的 patch 文件里，不再是目录里的
// `agent.cordis.yml`。
const STANDARD_PRESET_PATCH = join(PACKAGES, "bundle/web-app/presets/standard.patch.yml");
// 宿主平面（base bundle）的装配行：工具说明是按**这个会话最终可见的工具目录**送的，所以两处装配都要覆盖——
// 上游把新工具挂进 base（例如 0.2.1-alpha.2 的 `tool-working-directory`）时，只看 preset 会漏过去。
const BASE_BUNDLE_PATCH = join(PACKAGES, "bundle/base/cordis.patch.yml");

// 取 shipped standard preset 的 `config.plugins`（装配行数组）。
async function standardPlugins(): Promise<unknown> {
  const layers = yaml.load(await readFile(STANDARD_PRESET_PATCH, "utf8"), {
    schema: entryListSchema,
  }) as { insert?: { id?: string; config?: { plugins?: unknown } }[] }[];
  for (const layer of layers) {
    for (const row of layer.insert ?? []) {
      if (row.id === "preset-standard") return row.config?.plugins;
    }
  }
  throw new Error(`shipped standard preset row is missing in ${STANDARD_PRESET_PATCH}`);
}

// 取 base bundle 那一次 insert 的全部行。
async function basePlugins(): Promise<unknown> {
  const layers = yaml.load(await readFile(BASE_BUNDLE_PATCH, "utf8"), {
    schema: entryListSchema,
  }) as { insert?: unknown }[];
  const insert = layers.flatMap((layer) => (Array.isArray(layer.insert) ? layer.insert : []));
  if (insert.length === 0)
    throw new Error(`base bundle row list is missing in ${BASE_BUNDLE_PATCH}`);
  return insert;
}

// 不在分组表里的工具：装配里停掉的行，或已评估过、**有意不归本包管**的那批。新增项必须写清理由，
// 否则覆盖性断言会失败。
// - MCP 资源三件：本部署按需接入 MCP server 才有意义，工具说明留上游原文（用户明确不管这一批）。
const OUT_OF_SCOPE_TOOLS: readonly string[] = [
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
];

// 不由任何组回收、也不被注入通道丢弃的说明 section：与工具用法无关的部署级提示
// （plan 规则、文件引用语义、MCP 资源清单、Agent Teams 协作规则）。新增项必须写清理由，
// 否则覆盖性断言会失败。
const UNGATED_SECTIONS: readonly string[] = [
  "plan:policy",
  "context:file-reference",
  "mcp-resource-servers",
  "ui:deliverable-file-references",
  "team:policy",
];

// 每个组声明丢弃自己那批上游说明；平台噪音与未装配工具的说明由通道的默认清单丢弃。
function droppedSections(): Set<string> {
  return new Set(TOOL_GROUPS.flatMap((group) => group.drops));
}

// 委派那批行（`tool-subagent*` / `tool-workflow`）在这里**不算禁用**：上游把它们留在 host 层禁用、
// 由 preset 层接管，shipped standard 自己装着它们，所以照常为它们的工具归组。
interface CompositionRow {
  name?: unknown;
  disabled?: unknown;
  config?: unknown;
}

interface Row {
  readonly packageName: string;
  readonly enabled: boolean;
  // 装配行给出的动态工具名（`toolName:`），源码里没有这个字面量。
  readonly toolName?: string;
  // 装配行是否要求「按会话限制子代理可用模型」——它决定工具注册在哪一层。
  readonly modelSelection: boolean;
}

// 递归收集装配行；group 行的 config 是嵌套行数组。
function collectRows(value: unknown, rows: Row[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectRows(entry, rows);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const row = value as CompositionRow;
  // 只有没声明 `disabled`、或显式 `disabled: false` 的行才算启用：base 里用条件表达式
  // （`!!js "!ctx.get('profileContext')"`）停掉的行在本部署就是关的，扫它的工具只会造假阳性。
  const enabled = row.disabled === undefined || row.disabled === false;
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

// 从装配行取出源码目录名：`@deepseek-ai/dsh-tool-fs-search` → `tool-fs-search`。
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

// 取 `marker` 之后的第一个对象字面量，按花括号配平。
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

// 块内**顶层**的 `name`：PTC 那类代码生成源码里的 `defineTool(` 附近还有 `errorClass: { name: 'ToolCallError' }`
// 这种嵌套字面量，只认顶层的才不会把它们当成工具名。
function literalName(block: string): string | undefined {
  let depth = 0;
  for (let index = 0; index < block.length; index += 1) {
    const token = block[index];
    if (token === "{") depth += 1;
    else if (token === "}") depth -= 1;
    else if (depth === 1 && block.startsWith("name", index)) {
      const match = /^name:\s*['"]([^'"]+)['"]/.exec(block.slice(index));
      if (match !== null) return match[1];
    }
  }
  return undefined;
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

// 装配引用的包目录（跳过禁用的行）。
async function enabledDirectoriesOf(plugins: unknown): Promise<string[]> {
  const rows: Row[] = [];
  collectRows(plugins, rows);
  const wanted = new Set(
    rows.filter((row) => row.enabled).map((row) => directoryName(row.packageName)),
  );
  return (await packageDirectories()).filter((directory) =>
    wanted.has(directory.split("/").at(-1)!),
  );
}

// 装配里显式给出的动态工具名：源码扫描看不到这些字面量。
function declaredToolNamesOf(plugins: unknown): string[] {
  const rows: Row[] = [];
  collectRows(plugins, rows);
  return rows.flatMap((row) => (row.toolName === undefined || !row.enabled ? [] : [row.toolName]));
}

describe("覆盖性：标准模式的工具与说明都必须归组", () => {
  it("standard 装配引用的每个工具都在组表或豁免表里", async () => {
    const plugins = await standardPlugins();
    const { tools } = await inventory(await enabledDirectoriesOf(plugins));
    const known = new Set([...TOOL_GROUPS.flatMap((group) => group.tools), ...OUT_OF_SCOPE_TOOLS]);

    expect(
      [...new Set([...tools, ...declaredToolNamesOf(plugins)])]
        .filter((tool) => !known.has(tool))
        .sort(),
    ).toEqual([]);
  });

  it("宿主平面（base bundle）装配引用的每个工具都在组表或豁免表里", async () => {
    const plugins = await basePlugins();
    const { tools } = await inventory(await enabledDirectoriesOf(plugins));
    const known = new Set([...TOOL_GROUPS.flatMap((group) => group.tools), ...OUT_OF_SCOPE_TOOLS]);

    expect(
      [...new Set([...tools, ...declaredToolNamesOf(plugins)])]
        .filter((tool) => !known.has(tool))
        .sort(),
    ).toEqual([]);
  });

  it("standard 装配引用的每个工具说明 section 都有归属（丢弃 / 保留）", async () => {
    const { sections } = await inventory(await enabledDirectoriesOf(await standardPlugins()));
    const known = new Set([...droppedSections(), ...DEFAULT_SUPPRESS, ...UNGATED_SECTIONS]);

    expect([...sections].filter((section) => !known.has(section)).sort()).toEqual([]);
  });
});

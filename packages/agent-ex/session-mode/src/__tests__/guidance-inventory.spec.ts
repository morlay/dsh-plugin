import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPRESS, TOOL_GROUPS } from "@morlay/session-mode";

// patch 是 YAML 里的行清单：`entryListSchema` 只给 loader 做校验，这里读的是纯数据，不需要它。

// vitest 从仓库根跑（与其它读上游文件的 spec 同一约定），不用相对文件深度算。
// 扫描结果按进程缓存一次：这是纯文件读取，源码在用例生命周期里不变。
//
// 源包扫的是两份 bundle patch（`standard.patch.yml` / `cordis.patch.yml`）——那是**部署装配的产物**，
// 本仓没有这两份文件（装配面就是代码里的 provider 清单）。判据改成扫**上游全部包**：那是任何装配的超集，
// 覆盖性断言因此只会更严——新增一个上游工具或说明 section，这条就会红。
const REPO = process.cwd();
const PACKAGES = join(REPO, "vendor/deepseek-harness/packages");
// 本仓的判据扫描全部上游包目录（见文件头）。
async function allDirectories(): Promise<string[]> {
  return await packageDirectories();
}

// 不在分组表里的工具：装配里停掉的行，或已评估过、**有意不归本包管**的那批。新增项必须写清理由，
// 否则覆盖性断言会失败。
// - MCP 资源三件：本部署按需接入 MCP server 才有意义，工具说明留上游原文（用户明确不管这一批）。
const OUT_OF_SCOPE_TOOLS: readonly string[] = [
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
];

// 扫**全部上游包**（而不是某两份装配 patch）带出来的、本部署不装的那批行：它们住在实验包里，
// 本包的组表不管它们（工具说明留上游原文）。新增项必须写清理由，否则覆盖性断言会失败。
const UNASSEMBLED_TOOLS: readonly string[] = [
  // cordis 自带的内省工具（`cordis-plugin-inspector`）。
  "cordis_inspect_list",
  "cordis_inspect_query",
  // 实验包：worktree / 依赖预热 / LSP / 插件市场 / ralph 循环 / 会话查询。
  "create_worktree",
  "load_workspace_dependencies",
  "lsp",
  "plugin_market",
  "ralph",
  "session_event_read",
  "session_event_search",
  "session_event_trace",
  "session_search",
  "session_trace",
  // Office 技能加载后才出现的三条（`document/tool-office`）：本部署不装那条技能行。
  "office_convert",
  "office_recalculate",
  "office_render",
  // 终端面板（`experimental/terminal-panel`）：本部署不装那条实验行。
  "user_terminal_list",
  "user_terminal_read",
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
  // 部署 persona：`SystemPrompt` 自己注册的那两条（order 0），由模式的 persona 覆盖，不归通道管。
  "deployment:persona-prefix",
  "deployment:persona-suffix",
  // computer-use / browser-use 两条实验行的说明：本部署不装它们。
  "browser-use:stagehand-native",
  "computer-use:cua-driver-native",
  // 终端面板（`experimental/terminal-panel`）的说明：本部署不装那条实验行。
  "tool:pty-panel",
];

// 每个组声明丢弃自己那批上游说明；平台噪音与未装配工具的说明由通道的默认清单丢弃。
function droppedSections(): Set<string> {
  return new Set(TOOL_GROUPS.flatMap((group) => group.drops));
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

let cached: Promise<{ tools: Set<string>; sections: Set<string> }> | undefined;

async function inventory(directories: readonly string[]): Promise<{
  tools: Set<string>;
  sections: Set<string>;
}> {
  cached ??= scan(directories);
  return await cached;
}

// 扫源码只在第一次真做：这一层是纯文件读取，结果在用例生命周期里不变。
async function scan(directories: readonly string[]): Promise<{
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

describe("覆盖性：标准模式的工具与说明都必须归组", () => {
  it("standard 装配引用的每个工具都在组表或豁免表里", async () => {
    const { tools } = await inventory(await allDirectories());
    const known = new Set([
      ...TOOL_GROUPS.flatMap((group) => group.tools.map((entry) => entry.tool)),
      ...OUT_OF_SCOPE_TOOLS,
      ...UNASSEMBLED_TOOLS,
    ]);

    expect([...tools].filter((tool) => !known.has(tool)).sort()).toEqual([]);
  });

  it("宿主平面与 preset 平面的行清单合起来也只多出上游那批（同一个判据）", async () => {
    // 本仓没有那两份 patch：两次装配覆盖的正是同一份「全部上游包」的目录集，这条守的是**判据本身**，
    // 与新出现的工具名（第二条断言是它的哨兵）。
    const { tools } = await inventory(await allDirectories());
    const known = new Set([
      ...TOOL_GROUPS.flatMap((group) => group.tools.map((entry) => entry.tool)),
      ...OUT_OF_SCOPE_TOOLS,
      ...UNASSEMBLED_TOOLS,
    ]);

    expect([...tools].filter((tool) => !known.has(tool)).sort()).toEqual([]);
  });

  it("PTC 的专属 section 名与上游一致（`base` 正文靠它认出 PTC）", async () => {
    // 判据的取值来自上游：PTC 执行器把模型面收窄成 `run_code` 一条，装配期唯一能看到的信号就是它注册的
    // 这条 section（`PTC_ONLY_SECTION`）。上游改名时这条会红，逼着判据跟着改。
    const upstream = await readFile(join(PACKAGES, "core/tool-executor-ptc/src/index.ts"), "utf8");
    const name = /name:\s*'(tools:ptc-only)'/.exec(upstream)?.[1];
    // 判据住在本包的组表里（`PTC_ONLY_SECTION`）；读实现的源码文本即可。
    const ours = await readFile(new URL("../guidance/tool-groups.ts", import.meta.url), "utf8");

    expect(name).toBe("tools:ptc-only");
    expect(ours).toContain(`PTC_ONLY_SECTION = "${name}"`);
  });

  it("standard 装配引用的每个工具说明 section 都有归属（丢弃 / 保留）", async () => {
    const { sections } = await inventory(await allDirectories());
    const known = new Set([...droppedSections(), ...DEFAULT_SUPPRESS, ...UNGATED_SECTIONS]);

    expect([...sections].filter((section) => !known.has(section)).sort()).toEqual([]);
  });
});

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const UPSTREAM_PRESETS = join(
  dirname(fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-agent-presets/package.json"))),
  "presets",
);

export const PRESET_SOURCES = [
  {
    source: "standard",
    id: "standard",
    name: "标准模式",
    description:
      "功能完整的编码 Agent：初始只提供文件、Shell、检索等基础工具，其余能力组随任务按需启用。",
    order: 1,
    initial: [] as readonly string[],
  },
  {
    source: "standard",
    id: "collaboration",
    name: "协作模式",
    description:
      "在标准模式之上默认启用协作编排（子代理、工作流、队友协同）；流程与联网检索等能力组仍按需启用。",
    order: 2,
    initial: ["team"] as readonly string[],
  },
] as const;

function generatedHeader(): string {
  return `# 本文件由 packages/dsh-preset/tool/generate-presets.ts 生成，请勿手工编辑
`;
}

interface CompositionRow {
  id?: string;
  name?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 按 id 在装配行里找一行；`cordis:group` 行的 config 是嵌套行数组，需要递归。 */
function findRow(rows: readonly CompositionRow[], id: string): CompositionRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row;
    const nested = row.config;
    if (Array.isArray(nested)) {
      const found = findRow(nested as CompositionRow[], id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export const PERSONA_ROW_ID = "persona";

export const INSTRUCTIONS_ROW_ID = "agent-instructions";

/** 派生子代理的工具行：它的 `modelSelectionSettings` 决定工具注册在哪一层，见下方处理。 */
export const SUBAGENT_ROW_ID = "tool-subagent";

/**
 * 本部署在 preset 层禁用的行：`planning` 组只装 `plan-mode`（`/plan` 命令、`exit_plan_mode` 工具、
 * `plan:policy` section 都由它提供）。本部署不用 plan 模式——计划编排走自己的 skill，整组禁用。
 */
export const DISABLED_PRESET_ROW_IDS = ["planning"] as const;

export const TOOL_GATING_ROW_ID = "tool-gating";

export const TOOL_GATING_PLUGIN = "@morlay/dsh-tool-gating";

export const INSTRUCTIONS_CONFIG = {
  instructionFileCandidates: ["AGENTS.md"],
  localInstructionFileCandidates: ["AGENTS.local.md"],
} as const;

/** 每个 preset 都装配工具按需注入；`initial` 给出该模式的起始档位（基础组之外默认解锁的组）。 */
export function renderComposition(upstream: string, initial: readonly string[]): string {
  const rows = yaml.load(upstream, {
    schema: entryListSchema,
  }) as CompositionRow[];

  const persona = rows.findIndex((row) => row.id === PERSONA_ROW_ID);
  if (persona >= 0) rows.splice(persona, 1);
  const instructions = findRow(rows, INSTRUCTIONS_ROW_ID);
  if (instructions === undefined) {
    throw new Error(
      `generate-presets: upstream composition has no \`${INSTRUCTIONS_ROW_ID}\` row; ` +
        "upstream changed — re-check which plugin loads the workspace instructions",
    );
  }
  instructions.config = { ...instructions.config, ...INSTRUCTIONS_CONFIG };

  // `modelSelectionSettings` 会让 tool-subagent 在 standing scope 下把工具注册进 agent 自己的
  // 作用域，而 `tools.restrict()` 不过滤那一层——工具与它的说明因此绕开工具门控、永远可见。
  // 去掉它：子代理继承父会话的模型，工具回到 preset 层可门控。配套禁用提供者行
  // （`subagent-model-selection-settings`）见 cordis.patch.yml。
  const subagent = findRow(rows, SUBAGENT_ROW_ID);
  if (subagent === undefined) {
    throw new Error(
      `generate-presets: upstream composition has no \`${SUBAGENT_ROW_ID}\` row; ` +
        "upstream changed — re-check which plugin registers the spawn subagent tool",
    );
  }
  if (subagent.config !== undefined) delete subagent.config.modelSelectionSettings;

  for (const id of DISABLED_PRESET_ROW_IDS) {
    const row = findRow(rows, id);
    if (row === undefined) {
      throw new Error(
        `generate-presets: upstream composition has no \`${id}\` row; ` +
          "upstream changed — re-check which row carries the capability this deployment disables",
      );
    }
    row.disabled = true;
  }

  rows.push({
    id: TOOL_GATING_ROW_ID,
    name: TOOL_GATING_PLUGIN,
    ...(initial.length === 0 ? {} : { config: { initial: [...initial] } }),
  });

  const body = yaml.dump(rows, {
    schema: entryListSchema,
    lineWidth: -1,
    quotingType: '"',
  });
  return `${generatedHeader()}${body}`;
}

export function renderMetadata(entry: (typeof PRESET_SOURCES)[number]): string {
  return `name: ${entry.name}\ndescription: ${entry.description}\norder: ${String(entry.order)}\n`;
}

export const PRESETS_OUT_DIR = "dist/presets";

export async function generatePresets(
  outDir: string = join(PACKAGE_ROOT, PRESETS_OUT_DIR),
): Promise<string[]> {
  await rm(outDir, { recursive: true, force: true });
  const written: string[] = [];
  for (const entry of PRESET_SOURCES) {
    const upstream = await readFile(
      join(UPSTREAM_PRESETS, entry.source, "agent.cordis.yml"),
      "utf8",
    );

    const dir = join(outDir, entry.id);
    await mkdir(dir, { recursive: true });
    const compositionPath = join(dir, "agent.cordis.yml");
    await writeFile(compositionPath, renderComposition(upstream, entry.initial));
    const metadataPath = join(dir, "preset.yml");
    await writeFile(metadataPath, renderMetadata(entry));
    written.push(compositionPath, metadataPath);
  }
  return written;
}

export function presetHooks(): {
  "build:done": (ctx: { options: { outDir: string } }) => Promise<void>;
} {
  return {
    "build:done": async (ctx) => {
      const written = await generatePresets(join(ctx.options.outDir, "presets"));
      for (const path of written) process.stdout.write(`generated ${path}\n`);
    },
  };
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2];
  for (const path of await generatePresets(outDir)) {
    process.stdout.write(`generated ${path}\n`);
  }
}

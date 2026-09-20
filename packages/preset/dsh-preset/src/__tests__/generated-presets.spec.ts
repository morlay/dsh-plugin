import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";
import {
  PRESET_SOURCES,
  PERSONA_ROW_ID,
  DISABLED_PRESET_ROW_IDS,
  SUBAGENT_ROW_ID,
  TOOL_GATING_PLUGIN,
  TOOL_GATING_ROW_ID,
  UPSTREAM_PRESETS,
  generatePresets,
  renderMetadata,
} from "../../tool/generate-presets.ts";

const INSTRUCTIONS_ROW_ID = "agent-instructions";

const UPSTREAM_INSTRUCTIONS_PLUGIN = "@deepseek-ai/dsh-agent-instructions";

const PRODUCT_INSTRUCTION_CANDIDATES = ["AGENTS.md"];
const PRODUCT_LOCAL_INSTRUCTION_CANDIDATES = ["AGENTS.local.md"];

type CompositionRow = {
  id?: string;
  name?: string;
  /** 字段表；`cordis:group` 行的 config 是嵌套行数组（读取处显式断言）。 */
  config?: Record<string, unknown>;
  [key: string]: unknown;
};

type PresetSource = (typeof PRESET_SOURCES)[number];

const OUT_DIR = await mkdtemp(join(tmpdir(), "dsh-preset-"));
afterAll(async () => {
  await rm(OUT_DIR, { recursive: true, force: true });
});
await generatePresets(OUT_DIR);

function parseRows(text: string): CompositionRow[] {
  return yaml.load(text, { schema: entryListSchema }) as CompositionRow[];
}

async function readPair(
  entry: PresetSource,
): Promise<{ upstream: CompositionRow[]; product: CompositionRow[] }> {
  return {
    upstream: parseRows(
      await readFile(join(UPSTREAM_PRESETS, entry.source, "agent.cordis.yml"), "utf8"),
    ),
    product: parseRows(await readFile(join(OUT_DIR, entry.id, "agent.cordis.yml"), "utf8")),
  };
}

/** 生成器的期望值：上游行去掉 persona、收窄指令候选，再追加本模式的工具门控行。 */
function gatingRow(entry: PresetSource): CompositionRow {
  return {
    id: TOOL_GATING_ROW_ID,
    name: TOOL_GATING_PLUGIN,
    ...(entry.initial.length === 0 ? {} : { config: { initial: [...entry.initial] } }),
  };
}

/** 按 id 找一行：`cordis:group` 行的 config 是嵌套行数组，`tool-subagent` 就在里面。 */
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

/** 逐行算期望值：子代理行去掉 `modelSelectionSettings`，group 行递归。 */
function expectedRow(row: CompositionRow): CompositionRow {
  if (row.id !== undefined && (DISABLED_PRESET_ROW_IDS as readonly string[]).includes(row.id)) {
    return { ...row, disabled: true };
  }
  if (row.id === SUBAGENT_ROW_ID) {
    const config = { ...row.config };
    delete config.modelSelectionSettings;
    return { ...row, config };
  }
  const nested: unknown = row.config;
  if (Array.isArray(nested)) {
    return {
      ...row,
      config: (nested as CompositionRow[]).map(expectedRow) as unknown as Record<string, unknown>,
    };
  }
  return row;
}

function expectedRows(upstream: CompositionRow[], entry: PresetSource): CompositionRow[] {
  const rows = upstream
    .filter((row) => row.id !== PERSONA_ROW_ID)
    .map((row) =>
      row.id === INSTRUCTIONS_ROW_ID
        ? {
            ...row,
            config: {
              ...row.config,
              instructionFileCandidates: PRODUCT_INSTRUCTION_CANDIDATES,
              localInstructionFileCandidates: PRODUCT_LOCAL_INSTRUCTION_CANDIDATES,
            },
          }
        : expectedRow(row),
    );
  return [...rows, gatingRow(entry)];
}

describe("generated presets", () => {
  it.each(PRESET_SOURCES)(
    "$id equals its upstream source with only the persona row dropped, the instruction candidates narrowed, and the tool-gating row appended",
    async (entry) => {
      const { upstream, product } = await readPair(entry);

      expect(product).toEqual(expectedRows(upstream, entry));
    },
  );

  it.each(PRESET_SOURCES)(
    "$id drops the subagent model-selection opt-in so the subagent tool stays gateable",
    async (entry) => {
      const { upstream, product } = await readPair(entry);
      const upstreamRow = findRow(upstream, SUBAGENT_ROW_ID);
      const productRow = findRow(product, SUBAGENT_ROW_ID);

      // 上游开着它：子代理按会话限制可选模型，代价是工具注册进 agent own 层、绕开工具门控。
      expect(upstreamRow?.config?.modelSelectionSettings).toBe(true);
      expect(productRow?.config?.modelSelectionSettings).toBeUndefined();
      expect(productRow?.config?.provider).toBe("spawn");
      expect(productRow?.config?.toolName).toBe("subagent");
    },
  );

  it.each(PRESET_SOURCES)(
    "$id carries exactly one @morlay row: the tool-gating row",
    async (entry) => {
      const { product } = await readPair(entry);
      const morlayRows = product.filter(
        (row) => typeof row.name === "string" && row.name.startsWith("@morlay/"),
      );

      expect(morlayRows.map((row) => row.name)).toEqual([TOOL_GATING_PLUGIN]);
    },
  );

  it("only 协作模式 ships a non-empty initial level; 标准模式 starts from base", async () => {
    const levels = await Promise.all(
      PRESET_SOURCES.map(async (entry) => {
        const { product } = await readPair(entry);
        const row = product.find((candidate) => candidate.id === TOOL_GATING_ROW_ID);
        return { id: entry.id, initial: row?.config?.initial, expected: entry.initial };
      }),
    );

    for (const level of levels) {
      expect(level.expected).toEqual(level.id === "collaboration" ? ["team"] : []);
      if (level.expected.length === 0) expect(level.initial).toBeUndefined();
      else expect(level.initial).toEqual([...level.expected]);
    }
  });

  it.each(PRESET_SOURCES)(
    "$id keeps the agent-instructions row on the upstream plugin with AGENTS-only candidates",
    async (entry) => {
      const { upstream, product } = await readPair(entry);
      const upstreamRow = upstream.find((row) => row.id === INSTRUCTIONS_ROW_ID);
      const productRow = product.find((row) => row.id === INSTRUCTIONS_ROW_ID);

      expect(upstreamRow?.name).toBe(UPSTREAM_INSTRUCTIONS_PLUGIN);
      expect(productRow?.name).toBe(upstreamRow?.name);

      expect(productRow?.config?.instructionFileCandidates).toEqual(["AGENTS.md"]);
      expect(productRow?.config?.localInstructionFileCandidates).toEqual(["AGENTS.local.md"]);

      expect(productRow?.config?.maxBytes).toBe(upstreamRow?.config?.maxBytes);

      expect(productRow?.name?.startsWith("@morlay/")).toBe(false);
    },
  );

  it.each(PRESET_SOURCES)("$id carries generated metadata", async (entry) => {
    const actual = await readFile(join(OUT_DIR, entry.id, "preset.yml"), "utf8");
    expect(actual).toBe(renderMetadata(entry));

    expect(yaml.load(actual)).toEqual({
      name: entry.name,
      description: entry.description,
      order: entry.order,
    });
  });

  it("drops the persona row: the deployment system-prompt owns the persona", async () => {
    for (const entry of PRESET_SOURCES) {
      const text = await readFile(join(OUT_DIR, entry.id, "agent.cordis.yml"), "utf8");

      expect(text).not.toContain(`- id: ${PERSONA_ROW_ID}\n`);
      expect(text).not.toContain("You are a coding agent powered by the {{model}} model.");
    }
  });

  it("the output dir holds nothing beyond the generated presets", async () => {
    const expected = PRESET_SOURCES.map((entry) => entry.id).sort();
    const actual = (await readdir(OUT_DIR, { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort();
    expect(actual).toEqual(expected);
  });

  it("clears stale directories from a previous generation", async () => {
    await mkdir(join(OUT_DIR, "stale"), { recursive: true });
    await generatePresets(OUT_DIR);
    expect(await readdir(OUT_DIR)).not.toContain("stale");
  });

  it.each(PRESET_SOURCES)(
    "$id disables the plan-mode group this deployment does not use",
    async (entry) => {
      const { upstream, product } = await readPair(entry);
      const upstreamRow = findRow(upstream, "planning");
      const productRow = findRow(product, "planning");

      expect(upstreamRow?.disabled).not.toBe(true);
      expect(productRow?.disabled).toBe(true);
      // 组内那行仍然指向上游插件，只是整组不装载。
      expect(findRow(product, "plan-mode")?.name).toBe("@deepseek-ai/dsh-plan-mode");
    },
  );
});

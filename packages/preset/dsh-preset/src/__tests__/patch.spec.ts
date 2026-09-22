import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { renderPatch } from "../../tool/patch.ts";
import { PRESET_SOURCES } from "../../tool/presets/index.ts";

const PATCH_PATH = join(process.cwd(), "packages/preset/dsh-preset/cordis.patch.yml");
const UPSTREAM_BASE_PATCH = join(
  process.cwd(),
  "vendor/deepseek-harness/packages/bundle/base/cordis.patch.yml",
);
const UPSTREAM_WEB_APP_DIR = join(
  process.cwd(),
  "vendor/deepseek-harness/packages/bundle/web-app",
);
const UPSTREAM_WEB_APP_MANIFEST = join(UPSTREAM_WEB_APP_DIR, "package.json");

/**
 * web-app bundle 的全部 patch 层（`cordis.patch.yml` + `presets/*.patch.yml`）：shipped preset
 * 是其中的 `insert` 行，只加载主文件看不到它们。
 */
async function webAppLayers(): Promise<PatchRow[][]> {
  const manifest = JSON.parse(await readFile(UPSTREAM_WEB_APP_MANIFEST, "utf8")) as {
    dsh?: { bundle?: { patch?: string | string[] } };
  };
  const declared = manifest.dsh?.bundle?.patch ?? [];
  const files = typeof declared === "string" ? [declared] : declared;
  const layers: PatchRow[][] = [];
  for (const file of files) layers.push(await loadPatchRows(join(UPSTREAM_WEB_APP_DIR, file)));
  return layers;
}

interface PatchRow {
  id?: string;
  name?: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
  insert?: { id?: string; name?: string; config?: Record<string, unknown> }[];
}

async function loadPatchRows(path: string): Promise<PatchRow[]> {
  return yaml.load(await readFile(path, "utf8"), { schema: entryListSchema }) as PatchRow[];
}

/**
 * Compose patch layers over an empty root with the include's own patch algorithm —
 * the single `applyEntryPatches` call `boot()` (and `app-boot`'s `composeEntries`)
 * makes for a profile whose root file is `[]`, so a layer's id target resolves
 * against rows an earlier layer inserted.
 */
function composeLayers(layers: PatchRow[][]): PatchRow[] {
  const apply = applyEntryPatches as unknown as (
    data: unknown[],
    patches: unknown[],
    warn: (message: string, ...args: unknown[]) => void,
  ) => unknown[];
  return apply([], structuredClone(layers).flat(), () => {}) as PatchRow[];
}

function rowById(rows: readonly PatchRow[], id: string): PatchRow | undefined {
  return rows.find((row) => row.id === id);
}

const rows = await loadPatchRows(PATCH_PATH);

const inserted = rows.flatMap((row) => row.insert ?? []);

const sandboxRow = inserted.find((row) => row.id === "sandbox-local");

/** 我们禁用的官方 preset 行 id（patch 里那批，去掉非 preset 的行）。 */
function SHIPPED_PRESET_DISABLED_IDS(): string[] {
  return DISABLED_IDS.filter((id) => id.startsWith("preset-")).sort();
}

const DISABLED_IDS = [
  "preset-standard",
  "preset-ptc",
  "preset-minimal",
  "preset-cordis",
  "agent-instructions",
  "tool-skill",
  "sandbox",
  "fs-sandbox",
  "fs-observation-policy",
  "office-to-pdf",
  "subagent-model-selection-settings",
];

const INSERTED_IDS = [
  "preset-coding",
  "preset-chat",
  "sandbox-local",
  "context-assembler",
  "web-search-ollama",
];

describe("dsh-preset patch wiring", () => {
  it("仓库里那份带上了该有的装配（它是运行期各形态都要的文件，不能只靠 build 产出）", async () => {
    const rows = yaml.load(await readFile(PATCH_PATH, "utf8"), {
      schema: entryListSchema,
    }) as PatchRow[];
    const generated = yaml.load(renderPatch(), { schema: entryListSchema }) as PatchRow[];
    const shape = (list: PatchRow[]) => ({
      ids: list.map((row) => row.id ?? "(insert)"),
      disabled: list.filter((row) => row.disabled === true).map((row) => row.id),
      inserted: list.flatMap((row) => row.insert ?? []).map((row) => row.id),
    });

    // 与生成结果同一形状：改了 tool/patch.ts 忘了重新生成、或手改了这个文件，这里会红。
    expect(shape(rows)).toEqual(shape(generated));
    expect(shape(rows).inserted).toEqual(INSERTED_IDS);
    expect(shape(rows).disabled).toEqual(DISABLED_IDS);
  });

  it("生成的 patch 带上了该有的装配（改装配请改 tool/patch.ts）", () => {
    const rows = yaml.load(renderPatch(), { schema: entryListSchema }) as PatchRow[];
    const disabled = rows.filter((row) => row.disabled === true).map((row) => row.id);
    const inserted = rows.flatMap((row) => row.insert ?? []);

    // persona 按模式给（persona 行注册同名 section 遮蔽），patch 只关掉 harness identity 与运行时上下文。
    expect(rows.find((row) => row.id === "system-prompt")?.config?.personaPrefix).toBeUndefined();
    expect(disabled).toEqual(DISABLED_IDS);
    expect(inserted.map((row) => row.id)).toEqual(INSERTED_IDS);
    expect(
      renderPatch().startsWith("# 本文件由 packages/preset/dsh-preset/tool/patch.ts 生成"),
    ).toBe(true);
  });

  it("preset 就是一行 `@deepseek-ai/dsh-agent-preset`，config 逐项等于清单", () => {
    // 注册表不扫目录、不收路径：我们的模式只能以行的形态出现在这份 patch 里。
    for (const source of PRESET_SOURCES) {
      const row = inserted.find((candidate) => candidate.id === `preset-${source.id}`);

      expect(row?.name).toBe("@deepseek-ai/dsh-agent-preset");
      expect(row?.config).toEqual({
        id: source.id,
        name: source.name,
        description: source.description,
        order: source.order,
        // `!!js` 往返后仍是表达式节点，所以清单与产物逐字对得上。
        plugins: JSON.parse(JSON.stringify(source.rows)) as unknown,
      });
    }
    // 没有第三个模式被顺手带上：清单就是全部。
    expect(inserted.filter((row) => row.name === "@deepseek-ai/dsh-agent-preset")).toHaveLength(
      PRESET_SOURCES.length,
    );
  });

  it("注册表的默认模式取自清单的首项", () => {
    expect(rowById(rows, "agent-preset-registry")?.config).toEqual({
      default: PRESET_SOURCES[0]!.id,
    });
  });

  it("禁用的官方 preset 行 id 与 web-app bundle 实际插入的那批一致", async () => {
    // 上游把 shipped preset 拆成了预设 patch 文件（`packages/bundle/web-app/presets/*.patch.yml`），
    // 行 id 或文件名漂移时这里会红——不然官方那批会静默出现在选择器里，跟我们的模式并列。
    const shippedIds: string[] = [];
    for (const layer of await webAppLayers()) {
      for (const row of layer) {
        for (const entry of row.insert ?? []) {
          if (entry.name === "@deepseek-ai/dsh-agent-preset" && entry.id !== undefined) {
            shippedIds.push(entry.id);
          }
        }
      }
    }

    expect(shippedIds.sort()).toEqual(SHIPPED_PRESET_DISABLED_IDS());
  });

  it("disables the shipped sandbox rows and mounts the replacement in one layer", () => {
    expect(rows.filter((row) => row.disabled === true).map((row) => row.id)).toEqual(
      expect.arrayContaining(["sandbox", "fs-sandbox"]),
    );
    expect(inserted.filter((row) => row.id === "sandbox-local")).toHaveLength(1);
    expect(sandboxRow?.name).toBe("@morlay/dsh-sandbox-local");
  });

  it("disables the read-before-edit policy the shipped base bundle mounts", async () => {
    const shipped = composeLayers([await loadPatchRows(UPSTREAM_BASE_PATCH)]);
    const shippedRow = rowById(shipped, "fs-observation-policy");

    expect(shippedRow?.name).toBe("@deepseek-ai/dsh-fs-observation-policy");
    expect(shippedRow?.disabled).not.toBe(true);

    const composed = composeLayers([await loadPatchRows(UPSTREAM_BASE_PATCH), rows]);

    expect(rowById(composed, "fs-observation-policy")?.disabled).toBe(true);
  });

  it("disables the subagent model-selection provider the shipped web-app bundle inserts", async () => {
    const shipped = composeLayers(await webAppLayers());

    expect(rowById(shipped, "subagent-model-selection-settings")?.name).toBe(
      "@deepseek-ai/dsh-tool-subagent/model-selection-settings",
    );

    const composed = composeLayers([...(await webAppLayers()), rows]);

    expect(rowById(composed, "subagent-model-selection-settings")?.disabled).toBe(true);
  });

  it("disables the office-to-pdf row the shipped web-app bundle inserts", async () => {
    const shipped = composeLayers(await webAppLayers());
    const shippedRow = rowById(shipped, "office-to-pdf");

    expect(shippedRow?.name).toBe("@deepseek-ai/dsh-office-to-pdf");
    expect(shippedRow?.disabled).not.toBe(true);

    const composed = composeLayers([...(await webAppLayers()), rows]);

    expect(rowById(composed, "office-to-pdf")?.disabled).toBe(true);
  });

  it("disables every shipped agent-preset row the web-app bundle inserts", async () => {
    const composed = composeLayers([...(await webAppLayers()), rows]);

    for (const id of DISABLED_IDS.filter((candidate) => candidate.startsWith("preset-"))) {
      expect(rowById(composed, id)?.disabled, `not disabled: ${id}`).toBe(true);
    }
  });

  it("names rows that still exist in the shipped base bundle", async () => {
    const upstreamIds = new Set(
      [...(await readFile(UPSTREAM_BASE_PATCH, "utf8")).matchAll(/^\s*- id: (\S+)$/gm)].map(
        (match) => match[1]!,
      ),
    );

    for (const id of ["sandbox", "fs-sandbox"]) {
      expect(upstreamIds.has(id), `missing upstream row: ${id}`).toBe(true);
    }
  });

  it("carries the deployment sandbox rules on the inserted row", () => {
    const access = sandboxRow?.config?.access;

    expect(typeof access).toBe("string");
    expect(String(access)).toContain("rw {{ env.XDG_CACHE_HOME }}");
    expect(String(access)).toContain("rw {{ env.XDG_DATA_HOME }}");
    expect(String(access)).toContain("-- mise.*.toml");
    expect(String(access)).toContain("-- **/*.pem");
  });

  it("depends on the bundle whose service classes the inserted row mounts", async () => {
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), "packages/preset/dsh-preset/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(manifest.dependencies?.["@morlay/dsh-sandbox-local"]).toBeTruthy();
  });

  it("把 web 行的 searchProvider 切到本仓库的 ollama 后端，并保住 fetch 后端", async () => {
    const shipped = composeLayers([await loadPatchRows(UPSTREAM_BASE_PATCH)]);

    expect(rowById(shipped, "web")?.config).toEqual({
      searchProvider: "deepseek-official",
      fetchProvider: "http",
    });

    const composed = composeLayers([await loadPatchRows(UPSTREAM_BASE_PATCH), rows]);

    // config 是整体替换：只写 searchProvider 会把 fetchProvider 抹掉，所以两个字段都要在。
    expect(rowById(composed, "web")?.config).toEqual({ searchProvider: "ollama", fetchProvider: "http" });
  });

  it("装上 ollama 搜索后端行，并声明它的包依赖", async () => {
    const ollamaRow = inserted.find((row) => row.id === "web-search-ollama");

    expect(ollamaRow?.name).toBe("@morlay/dsh-web-search-ollama");
    expect(ollamaRow?.config).toEqual({ apiKeyEnv: "OLLAMA_API_KEY" });

    const manifest = JSON.parse(
      await readFile(join(process.cwd(), "packages/preset/dsh-preset/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(manifest.dependencies?.["@morlay/dsh-web-search-ollama"]).toBeTruthy();
  });

  it("ollama route 的图片上限对齐 llm-deepseek 的默认", () => {
    const providers = rowById(rows, "llm-pi-ai")?.config?.providers as
      | Record<string, Record<string, unknown>>
      | undefined;

    // 内联预算（20 MiB）与像素预算（2048²）两边默认本来就同值，只有每张请求版本的原始字节目标不同：
    // llm-deepseek 是 2 MiB，pi-ai 默认 1 MiB。
    expect(providers?.["ollama"]?.["requestImageMaxBytes"]).toBe(2 * 1024 * 1024);
  });
});

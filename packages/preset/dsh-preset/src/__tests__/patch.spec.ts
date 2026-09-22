import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { renderPatch } from "../../tool/patch.ts";

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

const DISABLED_IDS = ["sandbox", "fs-sandbox"];

const INSERTED_IDS = ["sandbox-local", "web-search-ollama"];

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

  it("生成的 patch 只留 host 层的部署配置", () => {
    const generated = yaml.load(renderPatch(), { schema: entryListSchema }) as PatchRow[];
    const disabled = generated.filter((row) => row.disabled === true).map((row) => row.id);
    const inserted = generated.flatMap((row) => row.insert ?? []);

    expect(disabled).toEqual(DISABLED_IDS);
    expect(inserted.map((row) => row.id)).toEqual(INSERTED_IDS);
    expect(
      renderPatch().startsWith("# 本文件由 packages/preset/dsh-preset/tool/patch.ts 生成"),
    ).toBe(true);
  });

  it("不碰 modes 的那些行：模式注册与 host 行开关都不在这里", () => {
    // 模式（coding / chat）由 `@morlay/dsh-agent-preset` 注册；上游 web-app bundle 自己把
    // `agent-instructions` / `tool-skill` / `skill-filesystem` 设在 preset 平面，host 这份再禁一次是
    // 重复动作——我们的模式与官方 preset 都在各自的行里挂。
    const ids = rows.flatMap((row) => [row.id, ...(row.insert ?? []).map((entry) => entry.id)]);

    expect(ids).not.toContain("preset-coding");
    expect(ids).not.toContain("preset-chat");
    expect(ids).not.toContain("agent-preset-registry");
    expect(rows.filter((row) => row.id === "system-prompt")).toEqual([]);
  });

  it("disables the shipped sandbox rows and mounts the replacement in one layer", () => {
    expect(rows.filter((row) => row.disabled === true).map((row) => row.id)).toEqual(
      expect.arrayContaining(["sandbox", "fs-sandbox"]),
    );
    expect(inserted.filter((row) => row.id === "sandbox-local")).toHaveLength(1);
    expect(sandboxRow?.name).toBe("@morlay/dsh-sandbox-local");
  });

  it("不碰 read-before-edit 策略：官方 preset 照旧吃上游那层，coding 由自己的行抵消", async () => {
    const shipped = composeLayers([await loadPatchRows(UPSTREAM_BASE_PATCH)]);

    expect(rowById(shipped, "fs-observation-policy")?.name).toBe(
      "@deepseek-ai/dsh-fs-observation-policy",
    );

    const composed = composeLayers([await loadPatchRows(UPSTREAM_BASE_PATCH), rows]);

    // 这是模式取舍、不是部署事实：禁用它是全局动作，会连官方 preset 一起关掉。
    expect(rowById(composed, "fs-observation-policy")?.disabled).not.toBe(true);
  });

  it("leaves the shipped subagent model-selection provider enabled for the official presets", async () => {
    // 官方 standard / ptc / cordis preset 的 `tool-subagent` 行带 `modelSelectionSettings: true`，它要求 host
    // scope 有这个服务；禁用它会把那三个官方 preset 打成 broken。我们不用该能力靠自己的行不带开关。
    const shipped = composeLayers(await webAppLayers());

    expect(rowById(shipped, "subagent-model-selection-settings")?.name).toBe(
      "@deepseek-ai/dsh-tool-subagent/model-selection-settings",
    );

    const composed = composeLayers([...(await webAppLayers()), rows]);
    const row = rowById(composed, "subagent-model-selection-settings");

    expect(row?.disabled).not.toBe(true);
    expect(row?.name).toBe("@deepseek-ai/dsh-tool-subagent/model-selection-settings");
  });

  it("只动自己声明的行：compose 前后的禁用集合只差这三条", async () => {
    // 上游两层都要在：base 插 `sandbox` / `fs-sandbox` / `fs-observation-policy`，web-app 覆盖其余。
    const shipped = [await loadPatchRows(UPSTREAM_BASE_PATCH), ...(await webAppLayers())];
    const before = new Set(
      composeLayers(shipped)
        .filter((row) => row.disabled === true)
        .map((row) => row.id),
    );
    const after = composeLayers([...shipped, rows]);
    const introduced = after
      .filter((row) => row.disabled === true && !before.has(row.id))
      .map((row) => row.id)
      .filter((id): id is string => id !== undefined);

    // 我们只关沙箱那两行；上游自己已禁的行（工作区指令 / skill 工具）、回到上游原味的行
    // （office 转档后端）与交给模式自己抵消的策略行（read-before-edit）一个都不该因为我们多出来。
    const byName = (left: string, right: string): number => left.localeCompare(right);

    expect(introduced.toSorted(byName)).toEqual([...DISABLED_IDS].toSorted(byName));

    const disabled = new Set(after.filter((row) => row.disabled === true).map((row) => row.id));

    // 上游 web-app bundle 自己把这两面设在 preset 平面，host 这份不再重复禁一次。
    expect(disabled.has("agent-instructions")).toBe(true);
    expect(disabled.has("tool-skill")).toBe(true);
    // 转档后端回到上游原味（Sidebar 的 Office 预览标签页因此可用）。
    expect(disabled.has("office-to-pdf")).toBe(false);
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

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { renderPatch } from "../../tool/patch.ts";

const PATCH_PATH = join(process.cwd(), "packages/profile/dsh-profile/cordis.patch.yml");
const UPSTREAM_BASE_PATCH = join(
  process.cwd(),
  "vendor/deepseek-harness/packages/bundle/base/cordis.patch.yml",
);
const UPSTREAM_WEB_APP_DIR = join(process.cwd(), "vendor/deepseek-harness/packages/bundle/web-app");
const UPSTREAM_WEB_APP_MANIFEST = join(UPSTREAM_WEB_APP_DIR, "package.json");
/** 装配的那一半：这两个 bundle 各自禁行/插行，本包只按 id 配值（app 的 bundles 把它们排在本包之前）。 */
const SANDBOX_BUNDLE_PATCH = join(
  process.cwd(),
  "packages/sandbox/dsh-sandbox-local/cordis.patch.yml",
);
const SEARCH_BUNDLE_PATCH = join(
  process.cwd(),
  "packages/web/dsh-web-search-ollama/cordis.patch.yml",
);

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

describe("dsh-profile patch wiring（只做配置初始化）", () => {
  it("仓库里那份与生成结果同形", async () => {
    const stored = yaml.load(await readFile(PATCH_PATH, "utf8"), {
      schema: entryListSchema,
    }) as PatchRow[];
    const generated = yaml.load(renderPatch(), { schema: entryListSchema }) as PatchRow[];

    expect(stored).toEqual(generated);
    expect(
      renderPatch().startsWith("# 本文件由 packages/profile/dsh-profile/tool/patch.ts 生成"),
    ).toBe(true);
  });

  it("只按 id 动别人插的行：一行都不插，禁的只有官方四个 preset", () => {
    expect(rows.flatMap((row) => row.insert ?? [])).toEqual([]);
    expect(rows.filter((row) => row.disabled === true).map((row) => row.id)).toEqual([
      "preset-standard",
      "preset-ptc",
      "preset-minimal",
      "preset-cordis",
    ]);
    for (const row of rows.filter((row) => row.disabled !== true)) expect(row.config).toBeTruthy();
  });

  it("三项默认值：界面语言、默认模型、对话视图", () => {
    expect(rowById(rows, "locale")?.config).toEqual({ preference: "zh" });
    expect(rowById(rows, "agent-default-model")?.config).toEqual({
      provider: "ollama",
      model: "deepseek-v4.1-flash",
      reasoningEffort: "high",
    });
    expect(rowById(rows, "ui-chat")?.config).toEqual({ transcriptView: "expanded" });
  });

  it("组合上游 web-app 层后：三项默认值确实落在对应行上", async () => {
    // `locale` / `ui-chat` 由 web-app 层设置，`agent-default-model` 由 base 层设置。
    const composed = composeLayers([
      await loadPatchRows(UPSTREAM_BASE_PATCH),
      ...(await webAppLayers()),
      rows,
    ]);

    expect(rowById(composed, "locale")?.config).toEqual({ preference: "zh" });
    expect(rowById(composed, "agent-default-model")?.config).toEqual({
      provider: "ollama",
      model: "deepseek-v4.1-flash",
      reasoningEffort: "high",
    });
    expect(rowById(composed, "ui-chat")?.config).toEqual({ transcriptView: "expanded" });
  });

  it("禁用官方四个 preset：它们确实由上游 presets 层插入，且组合后真的被关掉", async () => {
    const shipped = composeLayers(await webAppLayers());
    const shippedIds = new Set(
      shipped.flatMap((row) => [
        ...(row.id === undefined ? [] : [row.id]),
        ...(row.insert ?? []).flatMap((entry) => (entry.id === undefined ? [] : [entry.id])),
      ]),
    );

    for (const id of ["preset-standard", "preset-ptc", "preset-minimal", "preset-cordis"]) {
      expect(shippedIds.has(id), `上游 presets 层没有 ${id}`).toBe(true);
    }

    const composed = composeLayers([...(await webAppLayers()), rows]);

    for (const id of ["preset-standard", "preset-ptc", "preset-minimal", "preset-cordis"]) {
      expect(rowById(composed, id)?.disabled, id).toBe(true);
    }
    // 我们自己的模式仍是启用的（禁的是官方四个，不是"关掉全部"）。
    expect(rowById(composed, "preset-coding")?.disabled).not.toBe(true);
    expect(rowById(composed, "preset-chat")?.disabled).not.toBe(true);
  });

  it("配置覆盖的目标行都存在：上游行（llm-pi-ai / ui-settings-general / web）或能力 bundle 的行", async () => {
    const upstream = new Set(
      (await webAppLayers()).flat().flatMap((row) => [
        ...(row.id === undefined ? [] : [row.id]),
        ...(row.insert ?? []).flatMap((entry) => (entry.id === undefined ? [] : [entry.id])),
      ]),
    );
    const composed = composeLayers([
      await loadPatchRows(UPSTREAM_BASE_PATCH),
      await loadPatchRows(SANDBOX_BUNDLE_PATCH),
      await loadPatchRows(SEARCH_BUNDLE_PATCH),
    ]);

    for (const row of rows) {
      expect(
        row.id !== undefined && (composed.some((it) => it.id === row.id) || upstream.has(row.id)),
        `配置覆盖找不到目标行: ${String(row.id)}`,
      ).toBe(true);
    }
  });

  it("模式注册不在这里：本层只关官方四个 preset，不碰我们自己的注册行", () => {
    const ids = rows.flatMap((row) => [row.id, ...(row.insert ?? []).map((entry) => entry.id)]);

    expect(ids).not.toContain("preset-coding");
    expect(ids).not.toContain("preset-chat");
    expect(ids).not.toContain("agent-preset-registry");
    expect(rows.filter((row) => row.id === "system-prompt")).toEqual([]);
  });

  it("与沙箱 bundle 组合后：官方两行被禁、替换行拿到本层的规则", async () => {
    const composed = composeLayers([
      await loadPatchRows(UPSTREAM_BASE_PATCH),
      await loadPatchRows(SANDBOX_BUNDLE_PATCH),
      rows,
    ]);

    expect(rowById(composed, "sandbox")?.disabled).toBe(true);
    expect(rowById(composed, "fs-sandbox")?.disabled).toBe(true);

    const replacement = rowById(composed, "sandbox-local");
    expect(replacement?.name).toBe("@morlay/dsh-sandbox-local");
    const access = JSON.stringify(replacement?.config?.["access"]);
    expect(access).toContain("rw {{ env.XDG_CACHE_HOME }}");
    expect(access).toContain("rw {{ env.XDG_DATA_HOME }}");
    expect(access).toContain("-- mise.*.toml");
    expect(access).toContain("-- **/*.pem");
  });

  it("与搜索后端 bundle 组合后：web 行切到 ollama，注册行带 key 引用", async () => {
    const shipped = composeLayers([await loadPatchRows(UPSTREAM_BASE_PATCH)]);

    expect(rowById(shipped, "web")?.config).toEqual({
      searchProvider: "deepseek-official",
      fetchProvider: "http",
    });

    const composed = composeLayers([
      await loadPatchRows(UPSTREAM_BASE_PATCH),
      await loadPatchRows(SEARCH_BUNDLE_PATCH),
      rows,
    ]);

    // config 是整体替换：只写 searchProvider 会把 fetchProvider 抹掉，所以两个字段都要在。
    expect(rowById(composed, "web")?.config).toEqual({
      searchProvider: "ollama",
      fetchProvider: "http",
    });
    const registered = rowById(composed, "web-search-ollama");
    expect(registered?.name).toBe("@morlay/dsh-web-search-ollama");
    expect(registered?.config).toEqual({ apiKeyEnv: "OLLAMA_API_KEY" });
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

  it("首次引导预置成已确认，且与上游的版本常量一致", async () => {
    // 桌面形态的 client 不是 loopback → 上游把 settings 的持久化降级成 memory → 「确认过」写不回 host →
    // 每次打开页面都弹。host 侧预置当前版本即可绕过（上游 bump 后会再弹一次，符合它的语义）。
    const copy = await readFile(
      join(
        process.cwd(),
        "vendor/deepseek-harness/packages/client/ui-settings-models/src/onboarding-copy.ts",
      ),
      "utf8",
    );
    const version = /WELCOME_NOTICE_VERSION = '([^']+)'/u.exec(copy)?.[1];

    expect(version).toBeTruthy();
    expect(rowById(rows, "ui-settings-general")?.config).toEqual({
      welcomeNoticeVersion: version,
    });
  });

  it("ollama route 的图片上限对齐 llm-deepseek 的默认", () => {
    const providers = rowById(rows, "llm-pi-ai")?.config?.["providers"] as
      | Record<string, Record<string, unknown>>
      | undefined;

    // 内联预算（20 MiB）与像素预算（2048²）两边默认本来就同值，只有每张请求版本的原始字节目标不同：
    // llm-deepseek 是 2 MiB，pi-ai 默认 1 MiB。
    expect(providers?.["ollama"]?.["requestImageMaxBytes"]).toBe(2 * 1024 * 1024);
  });

  it("不再声明那两个能力包的依赖：行由它们的 bundle 带，本层只配值", async () => {
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), "packages/profile/dsh-profile/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(manifest.dependencies?.["@morlay/dsh-sandbox-local"]).toBeUndefined();
    expect(manifest.dependencies?.["@morlay/dsh-web-search-ollama"]).toBeUndefined();
  });
});

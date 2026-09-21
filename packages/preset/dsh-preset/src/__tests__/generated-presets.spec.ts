import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";
import {
  PRESET_SOURCES,
  generatePresets,
  renderComposition,
  renderMetadata,
} from "../../tool/generate-presets.ts";

interface Row {
  readonly id?: string;
  readonly name?: string;
  readonly group?: boolean;
  readonly config?: Record<string, unknown> | readonly Row[];
  readonly [key: string]: unknown;
}

const OUT_DIR = await mkdtemp(join(tmpdir(), "dsh-preset-"));
afterAll(async () => {
  await rm(OUT_DIR, { recursive: true, force: true });
});
await generatePresets(OUT_DIR);

function parseRows(text: string): Row[] {
  return yaml.load(text, { schema: entryListSchema }) as Row[];
}

/** 递归收集行里的 `@deepseek-ai/*` 包名（组行的 config 是子行数组）。 */
function upstreamNames(rows: readonly Row[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (typeof row.name === "string" && row.name.startsWith("@deepseek-ai/")) {
      names.push(row.name);
    }
    if (Array.isArray(row.config)) names.push(...upstreamNames(row.config as Row[]));
  }
  return names;
}

describe("generated presets", () => {
  it.each(PRESET_SOURCES)("$id equals its declared rows", async (entry) => {
    const actual = await readFile(join(OUT_DIR, entry.id, "agent.cordis.yml"), "utf8");

    expect(actual).toBe(renderComposition(entry.rows));
    // `!!js` 往返后仍是表达式节点，所以清单与产物逐字对得上。
    expect(parseRows(actual)).toEqual(JSON.parse(JSON.stringify(entry.rows)) as Row[]);
  });

  it.each(PRESET_SOURCES)("$id carries generated metadata", async (entry) => {
    const actual = await readFile(join(OUT_DIR, entry.id, "preset.yml"), "utf8");

    expect(actual).toBe(renderMetadata(entry));
    expect(yaml.load(actual)).toEqual({
      name: entry.name,
      description: entry.description,
      order: entry.order,
    });
  });

  it("mounts only resolvable packages, and each short name matches the package's own invariant", async () => {
    // 真源是**包自己声明的东西**（package.json 的 name、`./invariant` 的 name），不是某个 preset
    // 的组装结果——上游重排 preset 不该影响我们这条断言。
    // 带 subpath 的行（`…/list-agents`）是同一包的子出口，解析要落到包根。
    const roots = new Set(
      PRESET_SOURCES.flatMap((entry) =>
        upstreamNames([...entry.rows] as Row[]).map((name) =>
          name.split("/").slice(0, 2).join("/"),
        ),
      ),
    );
    const problems: string[] = [];

    for (const pkg of roots) {
      const manifestPath = fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        name?: string;
      };
      if (manifest.name !== pkg) problems.push(`${pkg}: manifest name is ${String(manifest.name)}`);

      // 不是每个包都带可加载的 invariant 伴生出口（有的导出只对特定条件开放）；带了的用它核对短名。
      const invariant = await import(`${pkg}/invariant`).then(
        (module: { name?: string }) => module,
        () => undefined,
      );
      if (invariant === undefined) continue;
      const short = pkg.replace("@deepseek-ai/dsh-", "");
      if (invariant.name !== `${short}-invariant`) {
        problems.push(`${pkg}: invariant name is ${String(invariant.name)}`);
      }
    }

    expect(problems).toEqual([]);
  });
  it("ships no disabled rows: each mode lists only what it mounts", async () => {
    const disabled = PRESET_SOURCES.flatMap((entry) =>
      (entry.rows as readonly Row[]).filter((row) => row.disabled !== undefined),
    );

    // 平台开关是唯一的例外：shell 工具装哪一半由运行期决定（`!!js`）。
    const ids = disabled.map((row) => row.id ?? "");
    expect(ids.sort((left, right) => left.localeCompare(right))).toEqual([
      "tool-bash",
      "tool-pwsh",
    ]);
  });

  it("only writes the declared presets", async () => {
    const entries = await readdir(OUT_DIR, { withFileTypes: true });

    expect(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(PRESET_SOURCES.map((entry) => entry.id).sort());
  });
});

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { PATCH_FILE, renderPatch } from "./patch.ts";
import { PRESET_SOURCES, type PresetSource } from "./presets/index.ts";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export { PRESET_SOURCES, type PresetSource };

/** 上游 preset 目录：只被覆盖性测试读，生成产物不再经过它。 */
export const UPSTREAM_PRESETS = join(
  dirname(fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-agent-presets/package.json"))),
  "presets",
);

function generatedHeader(): string {
  return `# 本文件由 packages/preset/dsh-preset/tool/generate-presets.ts 生成，请勿手工编辑
`;
}

/**
 * 产物的 composition：把 preset 的行清单 dump 成 include 的 YAML dialect。
 *
 * 行是**我们按需列的**（`tool/presets/*.ts`），不再从上游 composition 派生——派生要一直
 * "读上游 → 禁用/收窄"，产物里堆一串 `disabled: true`。`!!js` 表达式由 `jsExpr()` 从函数体取，
 * 所以平台开关这类运行期判断仍是编译器检查过的代码。
 */
export function renderComposition(rows: readonly PresetSource["rows"][number][]): string {
  const body = yaml.dump([...rows], {
    schema: entryListSchema,
    lineWidth: -1,
    quotingType: '"',
  });
  return `${generatedHeader()}${body}`;
}

export function renderMetadata(entry: PresetSource): string {
  return `name: ${entry.name}\ndescription: ${entry.description}\norder: ${String(entry.order)}\n`;
}

export const PRESETS_OUT_DIR = "dist/presets";

/** 产物标记：只有我们生成的 preset 子目录里有它。 */
const PRESET_MARKER = "preset.yml";

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

/**
 * 目标目录守卫：生成前会**清空**目标目录，所以只接受三种形状——不存在、空、只含我们生成的
 * preset 子目录（每个子目录带 `preset.yml`）。传一个已有目录（仓库根、home、随便一个目录）
 * 会被拒绝，而不是先被清掉。
 */
async function assertDisposableOutDir(outDir: string): Promise<void> {
  const entries = await readdir(outDir, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) return;
  for (const entry of entries) {
    const generated =
      entry.isDirectory() && (await isFile(join(outDir, entry.name, PRESET_MARKER)));
    if (generated) continue;
    throw new Error(
      `generate-presets: refusing to clear ${outDir} — it is not a generated presets directory ` +
        "(pass a new or empty directory, or the package's dist/presets)",
    );
  }
}

export async function generatePresets(
  outDir: string = join(PACKAGE_ROOT, PRESETS_OUT_DIR),
): Promise<string[]> {
  await assertDisposableOutDir(outDir);
  await rm(outDir, { recursive: true, force: true });
  const written: string[] = [];
  for (const entry of PRESET_SOURCES) {
    const dir = join(outDir, entry.id);
    await mkdir(dir, { recursive: true });
    const compositionPath = join(dir, "agent.cordis.yml");
    await writeFile(compositionPath, renderComposition(entry.rows));
    const metadataPath = join(dir, "preset.yml");
    await writeFile(metadataPath, renderMetadata(entry));
    written.push(compositionPath, metadataPath);
  }
  return written;
}

/** 把 bundle patch 写到包根：它是发布产物的一部分（`files` 里有它，装配按出口解析）。 */
export async function generatePatch(): Promise<string> {
  const path = join(PACKAGE_ROOT, PATCH_FILE);
  await writeFile(path, renderPatch());
  return path;
}

export function presetHooks(): {
  "build:done": (ctx: { options: { outDir: string } }) => Promise<void>;
} {
  return {
    "build:done": async (ctx) => {
      const written = [
        ...(await generatePresets(join(ctx.options.outDir, "presets"))),
        await generatePatch(),
      ];
      for (const path of written) process.stdout.write(`generated ${path}\n`);
    },
  };
}

/**
 * CLI 入口：只重生成产物目录。bundle patch 的落点是 `build:done` hook（它同时写 `cordis.patch.yml`）——
 * 手跑这条命令是为了看清单渲染出来的产物，不该顺手改仓库里入库的文件。
 */
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2];
  const written = await generatePresets(outDir);
  for (const path of written) process.stdout.write(`generated ${path}\n`);
}

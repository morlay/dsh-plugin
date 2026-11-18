// 构建期入口：从包的 `exports` 推导入口，用 rolldown 打 ESM 产物（host 面），产物落 `dist/`。
// 不依赖 tsdown：声明由 `just dts` 落位，清单由 `writeBuildManifest` 写回。
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rolldown } from "rolldown";
import { dtsRootOf, emitDts, repoRootOf } from "@local/dts-prepare";
import { bundleClientFactory } from "./cordis-client.ts";
import { cssInlinePlugins } from "./css.ts";

/** 一个包的构建计划：入口名 → 源码路径（相对包目录），以及只进发布态的入口名。 */
export interface BuildPlan {
  readonly name: string;
  readonly entries: Record<string, string>;
  readonly publishOnly: readonly string[];
  // 有 `dsh-bundle` 且有 `./ui` 的包：额外出一份 client（ESM 库 + CJS 工厂）。
  readonly client?: { readonly source: string };
  /** 含 `./dsh-bundle`：生成 `cordis.patch.yml` 并写 `dsh.bundle.patch`。 */
  readonly bundle?: boolean;
}

const SKIP_EXPORTS = new Set(["./package.json", "./cordis.patch.yml"]);

// 本地私有包前缀：`@local/*` 只活在本 workspace、从不发布——构建时一律内联进产物。
export const LOCAL_PACKAGE_PREFIX = "@local/";

/** 依赖 id 是否属于本地私有包（含子路径）。 */
export function isLocalPackage(id: string): boolean {
  return id.startsWith(LOCAL_PACKAGE_PREFIX);
}

/** 依赖 id 是否被 `inline` 选项点名（含子路径）。 */
export function isInlinedPackage(id: string, inline: readonly string[] | undefined): boolean {
  return inline?.some((name) => id === name || id.startsWith(`${name}/`)) ?? false;
}

/** 从 `package.json` 的 `exports` 推导入口；`./client` 与通配出口不在这里处理。 */
export async function planOf(cwd: string): Promise<BuildPlan> {
  const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
    name?: string;
    exports?: Record<string, unknown>;
  };
  const entries: Record<string, string> = {};
  const publishOnly: string[] = [];
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value !== "string" || !value.startsWith("./src/")) continue;
    if (SKIP_EXPORTS.has(key) || key.includes("*")) continue;
    const name = key === "." ? "index" : key.slice(2);
    if (name === "client") continue;
    entries[name] = value;
    if (name === "dsh-bundle") publishOnly.push(name);
  }
  const clientSource =
    entries["dsh-bundle"] !== undefined && entries["ui"] !== undefined ? entries["ui"] : undefined;
  return {
    name: manifest.name ?? "package",
    entries,
    publishOnly,
    ...(clientSource === undefined ? {} : { client: { source: clientSource } }),
    ...(entries["dsh-bundle"] === undefined ? {} : { bundle: true }),
  };
}

function isBare(id: string): boolean {
  return !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0");
}

/** 一个入口的产物文件名（按入口名）。 */
export type BuildArtifacts = Record<string, readonly string[]>;

/** 用 rolldown 打一个包的 host 面；依赖外置、`@local/*` 内联。 */
export async function buildPackage(cwd: string, plan: BuildPlan): Promise<BuildArtifacts> {
  // 每次构建先清产物目录：多入口与共享 chunk 的文件名带 hash，旧文件不清会混进发布包。
  await rm(join(cwd, "dist"), { recursive: true, force: true });
  const input = Object.fromEntries(
    Object.entries(plan.entries).map(([name, source]) => [name, join(cwd, source)]),
  );
  const bundle = await rolldown({
    input,
    platform: "node",
    external: (id: string) => isBare(id) && !isLocalPackage(id),
    resolve: { conditionNames: ["node", "import", "module", "default"] },
    plugins: [cssInlinePlugins({ name: plan.name, assets: "inline" })],
  });
  try {
    const { output } = await bundle.write({
      dir: join(cwd, "dist"),
      format: "esm",
      entryFileNames: "[name].mjs",
      chunkFileNames: "[name]-[hash].mjs",
      sourcemap: false,
    });
    const artifacts: Record<string, string[]> = {};
    for (const chunk of output) {
      if (chunk.type !== "chunk" || chunk.isEntry !== true) continue;
      artifacts[chunk.name] = [chunk.fileName];
    }
    // host 面声明：从 dts-prepare 的全仓声明树按入口聚合到 dist（client 不出声明）。
    const root = await repoRootOf(cwd);
    const dtsRoot = dtsRootOf(root);
    if (await stat(dtsRoot).then(() => true, () => false)) {
      await emitDts({ cwd, root, dtsRoot, entries: plan.entries, outDir: "dist" });
    }
    // bundle 且有 ui 的包：额外出 client 半——CJS 工厂给读字节的加载方。
    if (plan.client !== undefined) {
      const entry = join(cwd, plan.client.source);
      const factory = await bundleClientFactory({ name: plan.name, entry, cwd });
      await writeFile(join(cwd, "dist/client.cjs"), factory);
      artifacts["client"] = ["client.cjs"];
    }
    return artifacts;
  } finally {
    await bundle.close();
  }
}

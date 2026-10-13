import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { rolldown } from "rolldown";
import { clientBundleSpec } from "./cordis-client.ts";

// 三方依赖的 CJS→ESM 预打包（vite 的 `optimizeDeps` 那一层）。
//
// 仓库自己的包是 TS/ESM，逐文件转译直出即可；但 `node_modules` 里的三方包大量是 CJS——`require`、
// `module.exports`、`exports.x` 交织，还有 `process` / `global` 这类 CJS 专属自由变量，浏览器没有
// `require`。所以这一层必须整包预打包：把依赖闭包打成**单个 ESM 文件**，顺带完成 CJS→ESM 与多入口合并。
// 产物按内容 hash 命名，命中缓存就不再重建；依赖清单变了 hash 自然变。

/** 预打包产物：文件名（相对 `outDir`）与代码。 */
export interface PrebundledDependency {
  file: string;
  code: string;
  /** 是否命中已有缓存（没重新打包）。 */
  cached: boolean;
}

/**
 * 预打包一个依赖：从它的入口出发打成单个 ESM 文件。
 *
 * @param options.name - 依赖包名（参与缓存键与产物文件名）。
 * @param options.entry - 入口文件绝对路径（`node_modules/<pkg>/…`）。
 * @param options.version - 包版本（只用于日志与缓存键）。
 * @param options.outDir - 缓存目录（调用方给，通常是 profile 的 store）。
 */
export async function prebundleDependency(options: {
  name: string;
  entry: string;
  version?: string;
  outDir: string;
}): Promise<PrebundledDependency> {
  const spec = await clientBundleSpec({ cwd: dirname(options.entry) });
  const build = await rolldown({
    input: options.entry,
    cwd: dirname(options.entry),
    platform: "browser",
    resolve: { conditionNames: spec.conditionNames },
    // 浏览器产物的替换约定（`process.env` / `import.meta` 空壳）：CJS 依赖常读 `process.env.NODE_ENV`，
  // 不替掉会在浏览器里直接抛。
    transform: { define: spec.define },
  });
  let code: string;
  try {
    const { output } = await build.generate({
      format: "esm",
      codeSplitting: false,
      entryFileNames: "dependency.js",
    });
    const chunk = output.find((item) => item.type === "chunk");
    if (chunk === undefined || chunk.type !== "chunk") {
      throw new Error(`prebundle: ${options.name} produced no chunk`);
    }
    code = chunk.code;
  } finally {
    await build.close();
  }

  const hash = createHash("sha256")
    .update(`${options.name}@${options.version ?? ""}`)
    .update(options.entry)
    .update(code)
    .digest("hex")
    .slice(0, 12);
  const file = `${options.name.replace(/[^a-zA-Z0-9._-]/gu, "_")}-${hash}.js`;
  const target = join(options.outDir, file);
  try {
    const existing = await readFile(target, "utf8");
    if (existing === code) return { file, code, cached: true };
  } catch {
    // 没有缓存就写下去。
  }
  await mkdir(options.outDir, { recursive: true });
  await writeFile(target, code);
  return { file, code, cached: false };
}

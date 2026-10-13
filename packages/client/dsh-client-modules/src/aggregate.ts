/**
 * 按包聚合预编译。
 *
 * **打包单位是包，产物按出口分开**：一个包一次 rolldown（它的全部出口当多个 entry，`codeSplitting` 让共享
 * 部分只留一份），落盘到 `@plugins/<pkg>/<export>`；命中缓存的判据是"相关文件的指纹没变"——与 vite 的
 * `optimizeDeps` 同一套思路（它管三方，这里管 workspace 里那些**非开发模块**）。
 *
 * 为什么要聚合：dev 形态下未聚合的包是**逐文件**请求的，一个包几十个文件、几十个包就是几百个请求。
 * 但聚合会失去模块级 HMR，所以只有"这次不打算改的包"才走这条路（profile 的 `dsh.dev.exclude` 点名的
 * 那些，如 `@deepseek-ai/*`）；正在改的包仍然逐文件走 vite，HMR 照旧。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { cssInlinePlugins } from "@local/tsdown-plugin-cordis";
import { rolldown } from "rolldown";

/** 聚合缓存的根（`<DSH_HOME>/plugins`），下一级是 `<pkg>@<version>`。 */
export interface AggregateOptions {
  /** 缓存根目录。 */
  cacheRoot: string;
  /** 包名（原样，含 scope）。 */
  name: string;
  /** 包版本（进缓存键）。 */
  version: string;
  /** 包根目录。 */
  root: string;
  /** 出口名 → 源码文件。根出口用 `.`。 */
  exports: Record<string, string>;
}

/** 一个聚合包的产物：出口 → 相对缓存根的落盘路径。 */
export interface Aggregated {
  /** 输入指纹（相关文件的内容哈希）。 */
  rev: string;
  /** 出口名（`.` 表示根出口）→ 落盘路径。 */
  files: Map<string, string>;
}

/** 包名进目录名：`/` → `+`（与统一路径的转义一致）。 */
function encode(name: string): string {
  return name.replaceAll("/", "+");
}

/**
 * 三方依赖在浏览器里的地址：**vite 的 deps 产物**。
 *
 * 裸说明符浏览器不认，而 vite 已经把它们预打包在 `node_modules/.vite/deps/` 下、命名是把 `/` 换成 `_`
 * （`@lexical/history` → `@lexical_history.js`）——所以聚合产物里的 external 可以**直接指向那里**，
 * 让三方与 workspace 两侧共用同一份实例（这正是 vite dev 自己用的地址）。
 *
 * @param id - 裸说明符。
 * @returns 浏览器地址。
 */
function depsUrlOf(id: string): string {
  return `/node_modules/.vite/deps/${id.replaceAll("/", "_")}.js`;
}

/** 相关文件的指纹：包内 `src/**` 的内容哈希（名字 + 大小 + 内容）。 */
async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha1");
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const info = await stat(path);
      hash.update(`${relative(root, path).split(sep).join("/")}:${String(info.size)}`);
      hash.update(await readFile(path));
    }
  };
  await walk(join(root, "src"));
  return hash.digest("hex").slice(0, 16);
}

/**
 * 确保该包的聚合产物在（指纹没变就直接用）。
 *
 * @param options - 见 {@link AggregateOptions}。
 * @returns 产物映射与指纹；该包没有可打的出口时返回 undefined。
 */
export async function aggregatePackage(options: AggregateOptions): Promise<Aggregated | undefined> {
  const outDir = join(options.cacheRoot, `${encode(options.name)}@${options.version}`);
  const rev = await fingerprint(options.root);
  const stamp = join(outDir, ".rev");
  const cached = await readFile(stamp, "utf8").then(
    (value) => value.trim(),
    () => undefined,
  );
  const manifest = join(outDir, ".files.json");
  if (cached === rev) {
    const files = JSON.parse(await readFile(manifest, "utf8")) as Record<string, string>;
    return { rev, files: new Map(Object.entries(files)) };
  }

  const input: Record<string, string> = {};
  for (const [exportName, file] of Object.entries(options.exports)) {
    input[exportName === "." ? "index" : exportName.replace(/^\.\//u, "")] = file;
  }
  if (Object.keys(input).length === 0) return undefined;

  const build = await rolldown({
    input,
    cwd: options.root,
    platform: "browser",
    treeshake: false,
    // 包内（相对路径）inline；**裸说明符外置**，地址由 `output.paths` 指向 vite 的 deps 产物。
    external: (id: string) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
    // 样式照旧内联成"模块执行即注入 + 导出 class 映射"：rolldown 不再支持把 CSS 当资源打包，
    // 不处理就是 `UNSUPPORTED_FEATURE: Bundling CSS is no longer supported`（上游包都有 CSS Modules）。
    plugins: cssInlinePlugins({ name: options.name, assets: "inline" }),
  });
  try {
    const { output } = await build.generate({
      format: "es",
      codeSplitting: true,
      dir: outDir,
      entryFileNames: "[name].js",
      chunkFileNames: "chunk-[hash].js",
      paths: (id: string) => (id.startsWith("node:") ? id : depsUrlOf(id)),
    });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const files: Record<string, string> = {};
    for (const item of output) {
      if (item.type !== "chunk") continue;
      await writeFile(join(outDir, item.fileName), item.code, "utf8");
      files[item.name] = `${encode(options.name)}@${options.version}/${item.fileName}`;
    }
    await writeFile(manifest, `${JSON.stringify(files, null, 2)}\n`, "utf8");
    await writeFile(stamp, `${rev}\n`, "utf8");
    return { rev, files: new Map(Object.entries(files)) };
  } finally {
    await build.close();
  }
}

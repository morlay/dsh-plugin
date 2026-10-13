/**
 * 按包聚合：用 **vite 自己的 build** 产出（不是另写一套打包）。
 *
 * vite 8 底下就是 rolldown，转换规则、插件钩子、CSS 与资产的处理都在同一套配置里——所以这里复用
 * dev 那份配置（`cssInlinePlugins` / `clientAssetPlugin` / alias / define），只把它跑在 build 模式上：
 * 一个包一次构建、**产物按出口分开**（多个 entry + 共享 chunk）、落盘缓存、按输入指纹失效。
 *
 * 三方（react 这类）也走同一条链：裸说明符外置，地址统一由 `paths` 指到 `@deps/…`，因此两边共用同一份
 * 实例，不需要额外的机制。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { clientAssetPlugin, cssInlinePlugins } from "@local/tsdown-plugin-cordis";
import { build, type InlineConfig, type PluginOption } from "vite";
import { depsUrlOf } from "./deps.ts";

/** 一次聚合构建的输入。 */
export interface BundleOptions {
  /** 缓存根（`node_modules/.dsh-plugins`）。 */
  cacheRoot: string;
  /** 缓存键（`<pkg>@<version>`）。 */
  key: string;
  /** 仓库根（vite 的 root：`/@fs` 与依赖解析都要它）。 */
  repoRoot: string;
  /** 入口名 → 源码文件（出口名，`. ` 用 `index`）。 */
  input: Record<string, string>;
  /** 指纹的输入文件集（通常是包内的 `src/**`）。 */
  watch: readonly string[];
  /** 与 dev 共用的解析配置（alias）。 */
  alias: InlineConfig["resolve"] extends { alias?: infer A } ? A : never;
}

/** 聚合产物：出口 → 落盘路径（相对缓存根）。 */
export interface Bundled {
  /** 输入指纹。 */
  rev: string;
  /** 出口名 → 相对路径。 */
  files: Map<string, string>;
}

/** 目录下所有文件的内容指纹（名字 + 内容）。 */
async function fingerprint(paths: readonly string[]): Promise<string> {
  const hash = createHash("sha1");
  const walk = async (path: string): Promise<void> => {
    const info = await stat(path).catch(() => undefined);
    if (info === undefined) return;
    if (!info.isDirectory()) {
      hash.update(`${relative(paths[0] ?? path, path).split(sep).join("/")}:${String(info.size)}`);
      hash.update(await readFile(path));
      return;
    }
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      await walk(join(path, entry.name));
    }
  };
  for (const path of paths) await walk(path);
  return hash.digest("hex").slice(0, 16);
}

/**
 * 确保聚合产物在（指纹没变就直接用）。
 *
 * @param options - 见 {@link BundleOptions}。
 * @returns 产物映射；缓存命中时也走同一份清单。
 */
export async function bundleAggregate(options: BundleOptions): Promise<Bundled> {
  const outDir = join(options.cacheRoot, options.key);
  const manifestPath = join(outDir, ".files.json");
  const rev = await fingerprint(options.watch);
  const cached = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "{}")) as {
    rev?: string;
    files?: Record<string, string>;
  };
  if (cached.rev === rev && cached.files !== undefined) {
    return { rev, files: new Map(Object.entries(cached.files)) };
  }

  // **同一份配置**：CSS / 资产 / `?raw` / node 内置替身与 dev 用的是同一个插件；只有 alias 由调用方给。
  const plugins: PluginOption[] = [
    cssInlinePlugins({ name: options.key, assets: "threshold" }),
    clientAssetPlugin(),
  ];
  const result = await build({
    configFile: false,
    root: options.repoRoot,
    logLevel: "silent",
    publicDir: false,
    define: { "process.env": "{ env: {} }" },
    resolve: { alias: options.alias },
    plugins,
    build: {
      write: false,
      minify: false,
      target: "esnext",
      rollupOptions: {
        // 入口按 **root 相对**给：vite 会自己折算（绝对路径它也会折，但那条路上的解析基准不同）。
        input: Object.fromEntries(
          Object.entries(options.input).map(([name, file]) => [
            name,
            relative(options.repoRoot, file).split(sep).join("/"),
          ]),
        ),
        // 裸说明符外置：地址统一交给 `paths`（`@deps/…`），于是三方与我们的包共用同一条链。
        external: (id: string) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
        output: {
          format: "es",
          entryFileNames: "[name].js",
          chunkFileNames: "chunk-[hash].js",
          paths: (id: string) => (id.startsWith("node:") ? id : depsUrlOf(id)),
        },
      },
    },
  });
  // `write: false` 时 vite 返回输出对象（不是 watcher）；取 `output` 这一段。
  const outputs = (Array.isArray(result) ? result : [result]).filter((item) => "output" in item) as {
    output: readonly { type: string; fileName: string; name: string; code: string }[];
  }[];
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const files: Record<string, string> = {};
  for (const item of outputs) {
    for (const chunk of item.output) {
      if (chunk.type !== "chunk") continue;
      await writeFile(join(outDir, chunk.fileName), chunk.code, "utf8");
      files[chunk.name] = `${options.key}/${chunk.fileName}`;
    }
  }
  await writeFile(manifestPath, `${JSON.stringify({ rev, files }, null, 2)}\n`, "utf8");
  return { rev, files: new Map(Object.entries(files)) };
}

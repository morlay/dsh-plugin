/**
 * 三方依赖的预打包（`@deps/`）：**与聚合同一条链**（vite 的 build、同一份 CSS/资产插件），
 * 差别只在输入是 `node_modules` 里的包，且嵌套依赖也落 `@deps/`——整条依赖闭包因此同构。
 *
 * 这样 react 这类不需要特殊照顾：裸说明符外置后由 `paths` 统一指过来，两边共用同一份实例。
 */
import { createRequire } from "node:module";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { clientAssetPlugin, cssInlinePlugins } from "@local/tsdown-plugin-cordis";
import { build, type InlineConfig } from "vite";

/** 依赖在浏览器里的地址。 */
export function depsUrlOf(name: string): string {
  return `/@deps/${name.replaceAll("/", "+")}.js`;
}

/** 从 `@deps/` 地址回推包名。 */
export function depNameOf(segment: string): string {
  return segment.replace(/\.js$/u, "").replaceAll("+", "/");
}

/**
 * 确保某个依赖的产物在（清单没变就直接用）。
 *
 * @param options.cacheRoot - 缓存根（`node_modules/.dsh-deps`）。
 * @param options.repoRoot - 仓库根（vite 的 root）。
 * @param options.from - 解析基准（某份真实清单；pnpm 的软链由 node 解开）。
 * @param options.alias - 与 dev 共用的 alias。
 * @param options.name - 包名。
 * @returns 落盘路径（相对缓存根）；解析不到时 undefined。
 */
export async function bundleDep(options: {
  cacheRoot: string;
  repoRoot: string;
  from: string;
  alias: InlineConfig["resolve"] extends { alias?: infer A } ? A : never;
  name: string;
}): Promise<string | undefined> {
  const require = createRequire(options.from);
  let entry: string;
  try {
    entry = require.resolve(options.name);
  } catch {
    return undefined;
  }
  const pkgJson = await packageJsonNear(entry);
  const source = await readFile(pkgJson, "utf8").catch(() => "");
  const info = await stat(entry).catch(() => undefined);
  // 指纹：清单 + 入口（三方在 dev 期间不会改，够用且便宜）。
  const rev = `${String(source.length)}:${String(info?.size ?? 0)}:${source.slice(-64)}`;
  const key = options.name.replaceAll("/", "+");
  const dir = join(options.cacheRoot, key);
  const stamp = join(dir, ".dep.json");
  const cached = JSON.parse(await readFile(stamp, "utf8").catch(() => "{}")) as {
    rev?: string;
  };
  if (cached.rev === rev) return `${key}/index.js`;

  const result = await build({
    configFile: false,
    root: options.repoRoot,
    logLevel: "silent",
    publicDir: false,
    define: { "process.env": "{ env: {} }" },
    resolve: { alias: options.alias },
    plugins: [
      cssInlinePlugins({ name: key, assets: "threshold" }),
      clientAssetPlugin(),
    ] as never,
    build: {
      write: false,
      minify: false,
      target: "esnext",
      rollupOptions: {
        input: { index: entry },
        external: (id: string) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
        output: {
          format: "es",
          entryFileNames: "index.js",
          paths: (id: string) => (id.startsWith("node:") ? id : depsUrlOf(id)),
        },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).filter((item) => "output" in item) as {
    output: readonly { type: string; code: string }[];
  }[];
  const chunk = outputs.flatMap((item) => item.output).find((item) => item.type === "chunk");
  if (chunk === undefined || chunk.type !== "chunk") return undefined;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.js"), chunk.code, "utf8");
  await writeFile(stamp, `${JSON.stringify({ rev }, null, 2)}\n`, "utf8");
  return `${key}/index.js`;
}

/** 从入口文件向上找它所属包的 `package.json`。 */
async function packageJsonNear(file: string): Promise<string> {
  let directory = dirname(file);
  for (;;) {
    const candidate = join(directory, "package.json");
    if (await readFile(candidate, "utf8").then(() => true, () => false)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return candidate;
    directory = parent;
  }
}

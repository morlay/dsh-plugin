/**
 * 客户端资源的**联邦式**产出：一个包一份产物，三方的与我们的**没有本质区别**。
 *
 * vite 8 底下就是 rolldown，转换规则、插件钩子、CSS 与资产的处理都在同一套配置里——所以这里复用
 * dev 那份配置（`cssInlinePlugins` / `clientAssetPlugin` / alias / define），只把它跑在 build 模式上：
 * **一次构建、产物按出口分开**（多 entry + 共享 chunk）、落盘缓存、按输入指纹失效。
 *
 * 差别只在"入口从哪儿来"：我们的包按 `exports` 找它的 client 半，三方按 node 的解析找它的入口。
 * 两者产出的地址同构（`@client-modules/<pkg>@<version>/<file>`），所以运行时按 URL 取即可。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { clientAssetPlugin, cssInlinePlugins } from "@local/tsdown-plugin-cordis";
import { build, type PluginOption } from "vite";
import { packageNameOf } from "./resolve.ts";

/** 统一前缀：三方与我们的包共用同一个命名空间。 */
export const CLIENT_MODULES_PREFIX = "/@client-modules";

/** 统一缓存目录（与 vite 的 `.vite` 并列，跨进程共用）。 */
export const CLIENT_MODULES_CACHE = join("node_modules", ".dsh-client-modules");

/**
 * 构建器版本：**改了就 bump**。
 *
 * 缓存指纹算的是输入源码，而产物的形态还取决于这里的解析/改写规则（联邦地址怎么归一等）——
 * 规则变了、源码没变时，旧产物必须作废，否则会继续复用带着老 URL 的字节。
 */
const BUNDLER_REV = "3";

/** 包 → 它在浏览器里的地址（联邦式）。 */
export function depsUrlOf(specifier: string, version: string, file = "index.js"): string {
  // 归一到**包名**：说明符可能带子路径（`@deepseek-ai/dsh-x/client`、`react/jsx-dev-runtime`）。
  const name = packageNameOf(specifier) || specifier;
  return `${CLIENT_MODULES_PREFIX}/${name.replaceAll("/", "+")}@${version}/${file}`;
}

/** 一次产出的输入。 */
export interface BundleOptions {
  /** 缓存根（{@link CLIENT_MODULES_CACHE}）。 */
  cacheRoot: string;
  /** 仓库根（vite 的 root）。 */
  repoRoot: string;
  /** 与 dev 共用的解析配置（alias）。 */
  alias: readonly { find: RegExp | string; replacement: string }[];
  /** 包名。 */
  name: string;
  /** 包版本（进缓存键与地址）。 */
  version: string;
  /** 入口名 → 源码文件（我们的包：出口名；三方：`index`）。 */
  input: Record<string, string>;
  /** 指纹的输入文件集（我们的包给 `src`；三方给它的入口）。 */
  watch: readonly string[];
  /** 包名 → 版本：外置说明符要写成联邦地址（回调同步，故预建表）。 */
  versions?: ReadonlyMap<string, string>;
  /**
   * 包名 → 外置它时该指的**出口**（`client` / `index`）。
   *
   * `client` 不是什么特殊身份，就是清单里的一个普通 export：有 `./client` 的包外置成 `client.js`，
   * 没有的就是 `index.js`（= 根出口）。表是预建的，因为 `paths` 回调必须同步。
   */
  exportsOf?: ReadonlyMap<string, string>;
}

/** 产物：文件相对路径。 */
export interface Bundled {
  /** 输入指纹。 */
  rev: string;
  /** 出口名 → 相对缓存根的路径。 */
  files: Map<string, string>;
}

/** 目录/文件的内容指纹（名字 + 内容）。 */
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

/** 说明符 → 联邦地址（外置时用；同步）。 */
function urlOfSpecifier(options: BundleOptions, id: string): string {
  const bare = packageNameOf(id) || id;
  const exportName = options.exportsOf?.get(bare) ?? "index";
  return depsUrlOf(id, options.versions?.get(bare) ?? "0.0.0", `${exportName}.js`);
}

/**
 * 确保该包的产物在（指纹没变就直接用）。
 *
 * @param options - 见 {@link BundleOptions}。
 * @returns 产物映射；`input` 为空时 undefined。
 */
export async function bundlePackage(options: BundleOptions): Promise<Bundled | undefined> {
  process.stderr.write(
    `[bundle-in] ${options.name}: input=${Object.keys(options.input).join(",")} cache=${options.cacheRoot}\n`,
  );
  if (Object.keys(options.input).length === 0) return undefined;
  const key = `${options.name.replaceAll("/", "+")}@${options.version}`;
  const outDir = join(options.cacheRoot, key);
  const manifestPath = join(outDir, ".files.json");
  process.stderr.write(`[bundle-rev] ${options.name}: 开始算指纹 watch=${options.watch.join(",")}\n`);
  const rev = `${BUNDLER_REV}:${await fingerprint(options.watch)}`;
  process.stderr.write(`[bundle-rev] ${options.name}: 指纹=${rev}\n`);
  const cached = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "{}")) as {
    rev?: string;
    files?: Record<string, string>;
  };
  if (cached.rev === rev && cached.files !== undefined) {
    return { rev, files: new Map(Object.entries(cached.files)) };
  }

  // **同一份配置**：CSS / 资产 / `?raw` / node 内置替身与 dev 用的是同一个插件；只有 alias 由调用方给。
  const plugins: PluginOption[] = [
    cssInlinePlugins({ name: key, assets: "threshold" }),
    clientAssetPlugin(),
  ];
  const startedAt = Date.now();
  process.stderr.write(`[bundle-build] ${options.name}: vite build 开始\n`);
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
      // 走 `lib` 而不是 `rollupOptions.input`：库模式的入口语义明确（接受绝对路径，按 entry 名出产物）。
      lib: { entry: options.input, formats: ["es"], fileName: (_format, entryName) => `${entryName}.js` },
      rollupOptions: {
        // `node:*` **不算外置**：它得走 `clientAssetPlugin` 的浏览器替身（空壳）——产物是我们自己服务的，
        // 不经 vite 的 alias，原样留给浏览器就是 `Access to script at 'node:path' blocked by CORS`。
        external: (id: string) =>
          !id.startsWith("node:") &&
          !id.startsWith(".") &&
          !id.startsWith("/") &&
          !id.startsWith("\0"),
        output: {
          format: "es",
          entryFileNames: "[name].js",
          chunkFileNames: "chunk-[hash].js",
          paths: (id: string) => urlOfSpecifier(options, id),
        },
      },
    },
  });
  process.stderr.write(`[bundle-build] ${options.name}: vite build 结束（${String(Date.now() - startedAt)}ms）\n`);
  // `write: false` 时 vite 返回输出对象（不是 watcher）；取 `output` 这一段。
  const outputs = (Array.isArray(result) ? result : [result]).filter((item) => "output" in item) as {
    output: readonly { type: string; fileName: string; name: string; code: string }[];
  }[];
  const chunks = outputs.flatMap((item) => item.output).filter((item) => item.type === "chunk");
  if (chunks.length === 0) {
    process.stderr.write(
      `[bundle] ${options.name}: 输出为空（input=${Object.keys(options.input).join(",")} outputs=${String(outputs.length)}）\n`,
    );
    return undefined;
  }
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const files: Record<string, string> = {};
  for (const chunk of chunks) {
    await writeFile(join(outDir, chunk.fileName), chunk.code, "utf8");
    files[chunk.name] = `${key}/${chunk.fileName}`;
  }
  await writeFile(manifestPath, `${JSON.stringify({ rev, files }, null, 2)}\n`, "utf8");
  return { rev, files: new Map(Object.entries(files)) };
}

/** 三方的入口：按 node 的解析找（pnpm 的软链由它解开）。 */
export async function dependencyEntry(
  from: string,
  name: string,
): Promise<{ entry: string; version: string } | undefined> {
  const require = createRequire(from);
  let entry: string;
  try {
    entry = require.resolve(name);
  } catch {
    return undefined;
  }
  const manifest = await packageJsonNear(entry);
  const parsed = JSON.parse(await readFile(manifest, "utf8").catch(() => "{}")) as {
    version?: string;
  };
  return { entry, version: parsed.version ?? "0.0.0" };
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

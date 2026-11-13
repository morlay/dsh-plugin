/**
 * `client-modules` 的 vite 插件形态：开发态的客户端资源全部交给 vite（转译、CJS→ESM、HMR 都是它现成的
 * 能力），我们只提供"哪些行、从哪个源文件进"这一层，以及一个判据：**谁当文件、谁 prebundle**。
 *
 * 判据是正向白名单（{@link ClientPluginOptions.devFiles}）：点名的包走 vite 逐文件（要改它，靠 HMR），
 * 其余一律 prebundle——由我们自己那条链（`@client-modules/…`，按包 rolldown 构建 + 落盘缓存）产出。
 */
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { globToRegExp, isDevFile } from "../rows/dev-files.ts";
import { CLIENT_MODULES_PREFIX } from "../federation/bundle.ts";
import { clientHalfOf, packageNameOf, packageRootOf } from "./resolve.ts";

export interface ClientPluginOptions {
  /**
   * **当文件**的包名（glob，如 `@morlay/*`）：命中走 vite 逐文件（改它要 HMR）；其余一律 prebundle。
   *
   * 名单是白的、默认只放我们自己的包：上游（`@deepseek-ai/*`）的 client 之间有循环 re-export，
   * 逐文件服务会报 `Detected cycle while resolving name`；而漏配一个该改的包只是少了 HMR。
   */
  devFiles?: readonly string[];
  /** 仓库根（vite 的 root）。 */
  repoRoot: string;
  /**
   * 裸说明符 → **联邦地址**（`@client-modules/<pkg>@<ver>/<export>`）：prebundle 的唯一出口。
   * 三方、上游、以及仓库内没被点名的包都走它，vite 只该把这个地址当外部留着。
   */
  depsUrl?: (specifier: string, importer?: string) => Promise<string | undefined>;
  /** 每次 dev server 建好时回调（含 vite 自己 `restart()` 后的新实例）——调用方据此切换当前实例。 */
  onServer?: (server: ViteDevServer) => void;
}

/**
 * 「有 client 先用 client」：给定一条**从 client 图里发起**的相对引用，返回它的 client 变体（没有则 undefined）。
 *
 * 上游的包是同构的：`src/foo.ts` 与 `src/client/foo.ts` 成对，`src/client/index.ts` 会值导入 `../foo.ts`
 * 这类共享文件。若该共享文件在 client 侧有对应实现，就用它——这与 node 的 `browser` 字段、打包器的
 * `browser` 条件是同一件事，只是上游的 `exports` 没有为每个子路径声明 browser 条件。
 *
 * @param source - 引用说明符（相对路径）。
 * @param importer - 发起引用的文件（必在某个包的 `src/client/` 下）。
 * @returns client 变体的绝对路径，或 undefined（没有变体、或引用跨出了本包）。
 */
async function clientVariantOf(source: string, importer: string): Promise<string | undefined> {
  const marker = `${sep}src${sep}client${sep}`;
  const at = importer.indexOf(marker);
  if (at < 0) return undefined;
  // `<pkg>/src`
  const packageSrc = importer.slice(0, at + `${sep}src`.length);
  const target = resolvePath(dirname(importer), source);
  if (target.includes(marker)) return undefined;
  const relativeFromSrc = relative(packageSrc, target);
  if (relativeFromSrc.startsWith("..")) return undefined;
  const variant = join(packageSrc, "client", relativeFromSrc);
  return (await readFile(variant, "utf8").then(
    () => true,
    () => false,
  ))
    ? variant
    : undefined;
}

export function dshClientPlugin(options: ClientPluginOptions): Plugin {
  // 当文件名单由装配方经 `configure(FederationDefault, { dev })` 给（glob）；空表示**全部 prebundle**。
  const devFilePatterns = (): RegExp[] => (options.devFiles ?? []).map(globToRegExp);

  return {
    name: "dsh-client-rows",
    // **必须在 `vite:resolve` 之前**：vite 的解析器会先查 `optimizeDeps` 的缓存，命中就把裸说明符改写成
    // `node_modules/.vite/deps/…`（那条链一旦成立，同一个包就有两份实例——react 的 `Invalid hook call`
    // 就是这么来的）。我们这条链要自己说了算：裸说明符归 prebundle 地址、行包归源码。
    enforce: "pre",
    config() {
      return {
        resolve: {
          // 让 vite 认我们的条件顺序（与打包链一致）。
          conditions: ["browser", "import", "module", "default"],
        },
      };
    },
    async resolveId(source, importer) {
      // 联邦地址（`@client-modules/<pkg>@<version>/<export>`）：由我们自己那条链服务（按包预编译 + 落盘
      // 缓存），vite 只把它当**外部**留着。`external: "absolute"` 而不是 `true`：这是以 `/` 开头的地址，
      // vite 的预转换会把它当仓库文件去加载（日志里一串 `Failed to load url /_zephyr/@modules/…` 就是它）。
      if (source.startsWith(`${CLIENT_MODULES_PREFIX}/`))
        return { id: source, external: "absolute" };
      // `@/…` = **仓库内的本地文件**（页面与源码都用它引用仓库里别处的文件）：交给 alias，绝不外置。
      if (source.startsWith("@/")) return null;
      // 虚拟模块（\0 前缀）返回内部 id：`return null` 会被 vite 当外部地址，`load` 就轮不到。
      if (source.startsWith("\0")) return { id: source };
      // **「有 client 先用 client」**：与 node 的 `browser` 字段同构的补偿。上游的包是**同构**的——
      // `src/foo.ts`（宿主半）与 `src/client/foo.ts`（客户端半）成对出现，而 `src/client/index.ts` 会
      // 值导入 `../foo.ts` 这类共享文件；某些共享文件再往下引就会牵出宿主半（`http-bridge.ts` 用
      // `node:stream`）。凡是**从 client 图里发起的引用**，只要存在 client 变体就取变体。
      if (importer !== undefined && importer.includes(`${sep}src${sep}client${sep}`)) {
        const variant = await clientVariantOf(source, importer);
        if (variant !== undefined) return variant;
      }
      if (importer === undefined || source.startsWith(".") || source.startsWith("/")) return null;
      // 解析基准：虚拟模块（`\0…`）**不是**文件系统路径——`createRequire` 拿到它会直接抛
      // （行清单里的包名 import 就走在虚拟模块里）。以 `/` 开头的是仓库根相对路径。
      const bare = packageNameOf(source);
      // **资源类说明符不走「当文件」那条**：`clientHalfOf` 只认 `src/client/**` 的源码脚本，
      // `.css` / 字体 / 图片子路径必然落空 → 退回 vite → 地址不带 `/_zephyr` 前缀（404）。
      // 资源一律交给 prebundle 地址，由 `serve` + `cssShimOf` 产出样式。
      const assetLike = /\.(css|scss|less|woff2?|ttf|otf|png|jpe?g|gif|svg)$/u.test(source);
      if (!assetLike && bare !== "" && isDevFile(bare, devFilePatterns())) {
        // **名单点名的包当文件**：给出它的 client 半源码路径，vite 只当普通模块编译与缓存（HMR 照常）。
        const fromFile = importer.startsWith("\0")
          ? undefined
          : importer.startsWith("/")
            ? join(options.repoRoot, importer)
            : importer;
        if (fromFile !== undefined) {
          const pkg = await packageRootOf(fromFile, bare);
          if (pkg !== undefined) {
            const subpath = source === bare ? undefined : source.slice(bare.length + 1);
            const half = await clientHalfOf(pkg.root, subpath);
            if (half !== undefined) return half;
          }
        }
        // 点名了却解析不到 client 半：交给 vite 按 `exports` 落文件（同一条文件链），**绝不**进 prebundle
        // ——"点名"这件事说了算，落到哪条链不该看清单碰巧长什么样。
        return null;
      }
      // **其余一律 prebundle**（三方、上游、以及仓库内没点名的包）：交给联邦链按包预编译 + 落盘缓存。
      // 这一条是必需的：若放给 vite（`optimizeDeps`），同一份依赖会多出第二条链——浏览器里同时出现
      // `node_modules/.vite/deps/react.js` 与我们的 `@client-modules/react@…/index.js`，两个 react
      // 实例，hook 分发立刻报 `Invalid hook call`。
      if (options.depsUrl !== undefined) {
        const url = await options.depsUrl(source, importer);
        if (url !== undefined) return { id: url, external: true };
      }
      // prebundle 也答不上来（解析不到包）：交回 vite 自己按 `exports` 解析。
      return null;
    },
    configureServer(devServer) {
      options.onServer?.(devServer);
    },
  };
}

/**
 * `client-modules` 的 vite 插件形态：开发态的客户端资源全部交给 vite（依赖预打包、CJS→ESM、具名导出、
 * HMR 都是它现成的能力），我们只提供"哪些行、从哪个源文件进"这一层。
 *
 * 为什么不自己写这条链：`optimizeDeps` 处理的正是我们手搓过的那些事（CJS 转 ESM、具名导出补全、外置
 * `require` 转 import、共享 chunk 保证实例唯一、内容 hash 缓存），而 HMR 更是要自己实现一大套。插件只做
 * 三件事：把行清单变成虚拟入口、把包的说明符指到源码、把入口注入 HTML。
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { devExcluded, isAggregated } from "./config.ts";
import { CLIENT_MODULES_PREFIX } from "./bundle.ts";
import { clientHalfOf, exportTargetOf, packageNameOf, packageRootOf } from "./resolve.ts";

/** 行清单的虚拟模块 id（`app-boot/index.ts` 里 `import rows from "virtual:dsh-client-rows"`）。 */
export const ROWS_VIRTUAL = "dsh-client-rows";

const RESOLVED_ROWS = `\0${ROWS_VIRTUAL}`;

export interface ClientRowsPluginOptions {
  /** 仓库根（vite 的 root）。 */
  repoRoot: string;
  /** 行清单：包名 → client 半的**源码**入口（`src/client/index.ts` 那种）。 */
  rows: () => Promise<Map<string, string>>;
  /** 公共包（被多处引用，预打包时共享 chunk 才能保证实例唯一）：包名 → 源码入口。 */
  shared?: () => Promise<Map<string, string>>;
  /**
   * 把**对外形态**的 `/plugins/<pkg>/<version>/<export>` 解析成**源码文件**。
   *
   * 这一条是必需的：我们自己生成的装配脚本（以及各行的产物）里用的是对外 URL，而 vite 不认这种形态。
   * 由它把 URL 换成 vite 能继续处理的文件路径——浏览器请求那条路由时也是同一套解析。
   */
  resolvePluginUrl?: (url: string) => Promise<string | undefined>;
  /** 每次 dev server 建好时回调（含 vite 自己 `restart()` 后的新实例）——调用方据此切换当前实例。 */
  onServer?: (server: ViteDevServer) => void;
}

/**
 * 依赖预打包的入口名。vite 的 `optimizeDeps.entries` 期望"文件路径"，而我们手上是包名与源码路径的
 * 映射，所以用一个小技巧：把入口写成**虚拟模块**再让 vite 把它当 discovery 的种子——见 `configResolved`
 * 里的 `optimizeDeps.include`。
 */
/** 从某个文件向上找包根（有 `package.json` 的那一层）。 */
async function packageRootOfFile(file: string): Promise<string | undefined> {
  let directory = dirname(file);
  for (;;) {
    if (await readFile(join(directory, "package.json"), "utf8").then(() => true, () => false)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
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
  return (await readFile(variant, "utf8").then(() => true, () => false)) ? variant : undefined;
}

export function dshClientRowsPlugin(options: ClientRowsPluginOptions): Plugin {
  let server: ViteDevServer | undefined;
  let excludedCache: RegExp[] | undefined;
  const excludedOf = async (): Promise<RegExp[]> => (excludedCache ??= await devExcluded());
  const requireFromRepo = createRequire(join(options.repoRoot, "package.json"));

  return {
    name: "dsh-client-rows",
    config() {
      return {
        resolve: {
          // 让 vite 认我们的条件顺序（与打包链一致）。
          conditions: ["browser", "import", "module", "default"],
        },
      };
    },
    // 包名 → 源码入口：上游包经 exports 指到 `src`，工作区包本来就是源码；这里把两侧都显式接上，
    // 免得 vite 走 `main`/`dist`（那些在 dev 形态下要么不存在、要么是构建产物）。
    async resolveId(source, importer) {
      if (source === ROWS_VIRTUAL) return RESOLVED_ROWS;
      // 联邦地址（`@client-modules/<pkg>@<version>/<export>`）：它由我们自己的路由服务（聚合产物 /
      // 三方预打包），vite 只该把它当外部地址留在 import 里，不要试图去解析。
      if (source.startsWith(`${CLIENT_MODULES_PREFIX}/`)) return { id: source, external: true };
      // 聚合产物的 URL：它由 `dsh-client-modules` 自己的路由服务（按包预编译 + 落盘缓存），
      // vite 只该把它当外部地址保留在 import 里，不要试图去读文件。
      // 对外形态的 URL → 源码文件（vite 只认文件路径与它自己的虚拟 id）。
      if (source.startsWith("/") && options.resolvePluginUrl !== undefined) {
        const file = await options.resolvePluginUrl(source.split("?")[0] ?? source);
        if (file !== undefined) return file;
      }
      if (source.startsWith("\0")) return null;
      // **「有 client 先用 client」**：与 node 的 `browser` 字段同构的补偿。上游的包是**同构**的——
      // `src/foo.ts`（宿主半）与 `src/client/foo.ts`（客户端半）成对出现，而 `src/client/index.ts` 会
      // 值导入 `../foo.ts` 这类共享文件；某些共享文件再往下引就会牵出宿主半（`http-bridge.ts` 用
      // `node:stream`）。凡是**从 client 图里发起的引用**，只要存在 client 变体就取变体。
      if (importer !== undefined && importer.includes(`${sep}src${sep}client${sep}`)) {
        const variant = await clientVariantOf(source, importer);
        if (variant !== undefined) return variant;
      }
      if (importer === undefined || source.startsWith(".") || source.startsWith("/")) return null;
      // **仓库内的包**：默认一律落到源码文件——它们的 bare 包名一旦交给依赖优化器就会被预打包，于是同一个
      // 包既有预打包版又有源码版（两份实例，表现为「同 namespace 的 locale 已注册」）。
      //
      // 例外是 `dsh.dev.exclude` 点名的**非开发模块**：它们本来就该被预打包（`optimizeDeps.include` +
      // alias 指的也是同一个入口），所以这里**放行**，交给优化器。
      const fromFile = importer !== undefined && importer.startsWith("/") ? join(options.repoRoot, importer) : importer;
      if (fromFile !== undefined) {
        const bare = packageNameOf(source);
        if (bare !== "") {
          if (!isAggregated(bare, await excludedOf())) {
            const subpath = source === bare ? undefined : source.slice(bare.length + 1);
            const pkg = await packageRootOf(fromFile, bare);
            if (pkg !== undefined && !pkg.root.includes("node_modules")) {
              const half = await clientHalfOf(pkg.root, subpath);
              if (half !== undefined) return half;
            }
          }
        }
      }
      // 行包名 → 它的 **client 半**源文件（行清单已经解析好；vite 只负责把它当普通模块编译与缓存）。
      const rows = await options.rows();
      const shared = (await options.shared?.()) ?? new Map<string, string>();
      const known = rows.get(source) ?? shared.get(source);
      if (known !== undefined) {
        void server;
        // 值是它**自己的名字**：这一行是"非开发模块"，入口交给 `optimizeDeps`（alias 指的也是同一个
        // 源文件）——这里放行，别拦成源码路径，否则预打包与引用成了两个身份。
        if (known === source) return null;
        return known;
      }
      // **行包 + 子路径**（`@deepseek-ai/dsh-client-ui-theme/brand-font.css` 这种）：包在 vendor 下、root 的
      // node_modules 里没有，vite 自己解析不到；用行的包根 + 清单的 `exports` 落文件（标准 exports 语义）。
      const slash = source.startsWith("@") ? source.indexOf("/", source.indexOf("/") + 1) : source.indexOf("/");
      if (slash > 0) {
        const pkgName = source.slice(0, slash);
        const subpath = source.slice(slash + 1);
        const rowPath = rows.get(pkgName) ?? shared.get(pkgName);
        if (rowPath !== undefined) {
          const rowRoot = await packageRootOfFile(rowPath);
          const target = rowRoot === undefined ? undefined : await exportTargetOf(rowRoot, subpath);
          if (target !== undefined) return target;
        }
      }
      // 其余交给 vite 自己按 exports 解析。
      void requireFromRepo;
      return null;
    },
    // 应用入口：把我们生成的装配脚本作为虚拟模块交给 vite 服务（这样它的 import、HMR、依赖图都由
    // vite 管；我们不必自己拦一条路由再手写 HTTP）。
    async load(id) {
      if (id !== RESOLVED_ROWS) return null;
      const rows = await options.rows();
      const shared = (await options.shared?.()) ?? new Map<string, string>();
      // import **源码文件路径**（不是包名）：包名会让依赖优化器把它当"依赖"预打包，于是同一个包出现
      // 预打包版与源码版两份实例（症状是「同 namespace 的 locale 已注册」与跨实例的私有字段报错）。
      // 文件路径只走源码面，vite 照常转译它。
      const imports: string[] = [];
      const entries: string[] = [];
      let index = 0;
      for (const [pkg, file] of [...shared, ...rows]) {
        const alias = `m${String(index)}`;
        imports.push(`import * as ${alias} from ${JSON.stringify(file)};`);
        entries.push(`  { id: ${JSON.stringify(pkg)}, module: ${alias} },`);
        index += 1;
      }
      // 具名导出 `default` 供 `app-boot/index.ts` 消费：一份可遍历的行清单。
      return [...imports, "", "export default [", ...entries, "];", ""].join("\n");
    },
    configureServer(devServer) {
      server = devServer;
      options.onServer?.(devServer);
    },
  };
}

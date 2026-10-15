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
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { clientAssetPlugin, NODE_BUILTIN } from "./assets.ts";
import { cssInlinePlugins } from "./styles.ts";
import { rolldown, type Plugin } from "rolldown";
import { esmExternalRequirePlugin, type PluginOption } from "vite";
import { encodePackageName, entryFileNameOf, packageNameOf } from "./resolve.ts";

/** 裸包名 → `^名(/|$)`：既覆盖子路径引用，也不会把 `node:fs`、`./x` 误判成包。 */
function barePackageRegExp(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:/|$)`, "u");
}

/** 统一前缀：三方与我们的包共用同一个命名空间。 */
export const CLIENT_MODULES_PREFIX = "/@client-modules";

/** 统一缓存目录（与 vite 的 `.vite` 并列，跨进程共用）。 */
export const CLIENT_MODULES_CACHE = join("node_modules", ".dsh-client-modules");

/**
 * 客户端资源链的**解析约定**（dev 的 vite server 与联邦构建各持一份，规则相同）。
 *
 * - `@/…` = 仓库根的文件（源码里引用仓库内文件都用这个前缀，不写死绝对路径）；
 * - `node:*` = 求值安全的空替身文件。**整串匹配**：`find: /^node:/` 是前缀替换，会把 `node:fs/promises`
 *   拼成 `<替身路径>fs/promises`（构建期报 UNLOADABLE_DEPENDENCY）。
 *
 * 替身的**形态**两条链不同（dev 是 ESM、构建要 CJS，见 `app-boot/node-stub.*` 里各自的说明），
 * 所以由调用方给路径。
 */
export function clientModulesAlias(options: {
  repoRoot: string;
  nodeStub: string;
}): { find: RegExp; replacement: string }[] {
  return [
    { find: /^@\//u, replacement: `${options.repoRoot}/` },
    // **裸名的内置也要接管**：产物里出现的是 `require("zlib")`、`import { Readable } from "stream"`
    // 这类写法（没有 `node:` 前缀），只匹配前缀会让它们漏到浏览器里当包解析——那边报的是一串
    // `@client-modules/zlib@0.0.0/index.js` 404。名单与联邦构建用的是同一份。
    { find: NODE_BUILTIN, replacement: options.nodeStub },
  ];
}

/**
 * 构建器版本：**改了就 bump**。
 *
 * 缓存指纹算的是输入源码，而产物的形态还取决于这里的解析/改写规则（联邦地址怎么归一等）——
 * 规则变了、源码没变时，旧产物必须作废，否则会继续复用带着老 URL 的字节。
 */
/** 构建器**规则**版本：改解析 / 改写规则就 bump（见 {@link BUNDLER_REV}）。 */
const BUNDLER_RULES = "21";

/**
 * 地址里的 `?v=`（与 vite 同一个写法）：构建器**规则指纹**（`BUNDLER_RULES` 的哈希，形如 vite 的 `?v=`）。
 *
 * 它只随"这条链的规则"变化——一次会话内所有地址一致（同一个包只有一个 URL，多一个 URL 就多一份模块
 * 实例）。内容变了**不换 URL**，靠 `cache-control: no-cache` + `ETag` 协商（vite dev 对它自己的模块
 * 也是这套）。
 */
export const BUNDLER_REV: string = createHash("sha1")
  .update(`client-modules:rules:${BUNDLER_RULES}`)
  .digest("hex")
  .slice(0, 8);

/** 包 → 它在浏览器里的地址（联邦式）。 */
export function depsUrlOf(specifier: string, version: string, file = "index.js"): string {
  // 归一到**包名**：说明符可能带子路径（`@deepseek-ai/dsh-x/client`、`react/jsx-dev-runtime`）。
  const name = packageNameOf(specifier) || specifier;
  return `${CLIENT_MODULES_PREFIX}/${encodePackageName(name)}@${version}/${file}`;
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
  /** 编译设置（rolldown 的 `tsconfig`）：解析根那份 tsconfig 的路径；缺省时交给 rolldown 就近找。 */
  tsconfig?: string;
  /**
   * 包名 → 外置它时该指的**出口**（`client` / `index`）。
   *
   * `client` 不是什么特殊身份，就是清单里的一个普通 export：有 `./client` 的包外置成 `client.js`，
   * 没有的就是 `index.js`（= 根出口）。表是预建的，因为 `paths` 回调必须同步。
   */
}

/** 产物：文件相对路径。 */
export interface Bundled {
  /** 输入指纹。 */
  rev: string;
  /** 出口名 → 相对缓存根的路径。 */
  files: Map<string, string>;
}

/** 缓存目录名（也是产物目录的键）：`<pkg>@<version>`，scope 的 `/` 转义成 `+`。 */
export function cacheKeyOf(name: string, version: string): string {
  return `${encodePackageName(name)}@${version}`;
}

/**
 * 目录/文件的内容指纹（名字 + 内容）。
 *
 * 先按**元信息**（名字 + 大小 + mtime）攒一个快速戳：戳没变就直接复用上次的指纹——否则每次请求都要把
 * 每个包的源码**读一遍**（几百个包 × 每个包几十个文件），首屏全耗在算指纹上。
 */
const fingerprints = new Map<string, { stamp: string; rev: string }>();

async function fingerprint(paths: readonly string[]): Promise<string> {
  const key = paths.join("|");
  const stampHash = createHash("sha1");
  const collect = async (path: string): Promise<void> => {
    const info = await stat(path).catch(() => undefined);
    if (info === undefined) return;
    if (!info.isDirectory()) {
      stampHash.update(`${relative(paths[0] ?? path, path).split(sep).join("/")}:${String(info.size)}:${String(info.mtimeMs)}`);
      return;
    }
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      await collect(join(path, entry.name));
    }
  };
  for (const path of paths) await collect(path);
  const stamp = stampHash.digest("hex");
  const cached = fingerprints.get(key);
  if (cached?.stamp === stamp) return cached.rev;

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
  const rev = hash.digest("hex").slice(0, 16);
  fingerprints.set(key, { stamp, rev });
  return rev;
}

/**
 * 说明符 → 联邦地址（同步：`paths` 回调与 vite 的 `resolveId` 都要求同步可答）。
 *
 * 两端共用这一份：产物里外置的 `import` / `require`，与 dev 侧源码里的裸说明符——同一条链、同一种地址。
 *
 * `?v=` 是**构建世代**（{@link BUNDLER_REV}，与 vite 同名的 query 参数）：所有地址一次会话内稳定一致——同一个包**只有一个 URL**
 * （多一个 URL 就多一份模块实例）。内容变了**不换 URL**，靠 `cache-control: no-cache` + `ETag` 协商
 * ——vite dev 对它自己的模块也是这套。
 */
export function urlOf(
  specifier: string,
  tables: { versions?: ReadonlyMap<string, string>; clientRows?: ReadonlySet<string> },
): string {
  const bare = packageNameOf(specifier) || specifier;
  const version = tables.versions?.get(bare) ?? "0.0.0";
  // **子路径引用**（`pkg/sub`，如 rolldown 注入的 `@oxc-project/runtime/helpers/decorate`、三方的
  // `katex/dist/katex.min.css`）保留子路径——也**不要**自作主张加 `.js`（子路径本身可能带扩展名：`.css`）。
  //
  // **包级引用**的出口按"它是不是行"分（`dsh.client` + client 半，由 loader 给）：
  // - **行** → `client.js`：行的客户端产物就是它的 client 半。以前这里向一张"包名 → client/index"的表要
  //   出口名，那张表是按 `exports` 里有没有 `./client` 猜的——于是没有该键的行（`@deepseek-ai/dsh-api-*`）
  //   被打成 `index.js`（宿主半）。
  // - **普通 npm 包**（三方、被依赖的）→ `index.js`：出口按 npm 语义（包的根出口）。
  // **子路径引用**（`pkg/sub`）保留子路径——但**扩展名要统一**：产物名一律 `<出口名>.js`（`entryFileNames`），
  // 所以只带包内路径的引用（`zustand/vanilla`）要补 `.js`，否则 URL 一半带（`index.js`）、一半不带（`vanilla`），
  // 而磁盘上的文件名全都带。本来就有扩展名的（`katex/dist/katex.min.css`）原样。
  const subpath = specifier === bare ? "" : specifier.slice(bare.length + 1);
  // 扩展名统一走 {@link entryFileNameOf} 那条约定：本来有扩展名的（`katex/dist/katex.min.css`）原样，
  // 其余按"出口产物文件名 = `<出口名>.js`"补上。
  const file =
    subpath !== ""
      ? /\.[a-z0-9]+$/iu.test(subpath)
        ? subpath
        : entryFileNameOf(subpath)
      : entryFileNameOf(tables.clientRows?.has(bare) === true ? "client" : "index");
  return depsUrlOf(specifier, version, `${file}?v=${BUNDLER_REV}`);
}

/**
 * 依赖里的 `process.env`。
 *
 * 顶层的 `define` 只作用于我们的源码面：`node_modules` 里的包直接进产物，而 `immer@10` 的
 * `dist/immer.mjs` 在模块顶层就读 `process.env.NODE_ENV`——浏览器里没有 `process`，一个
 * `process is not defined` 会把整份产物带下去。
 *
 * **只替换 `process.env` 系列**：裸的 `process` 不能碰——它可能只是个普通标识符（`zod` 里就有一个叫
 * `process` 的函数，替换掉直接把源码变成语法错误）。
 */
function browserProcessPlugin(): PluginOption {
  const replace = (code: string): string =>
    code
      .replaceAll(/\bprocess\.env\.NODE_ENV\b/gu, JSON.stringify("development"))
      .replaceAll(/\bprocess\.env\b/gu, "({ env: {} })");
  return {
    name: "dsh-browser-process",
    enforce: "pre",
    transform(code: string) {
      if (!code.includes("process.env")) return null;
      return { code: replace(code), map: null };
    },
  };
}

/**
 * CJS 入口的**具名导出包装**（`react` 这类）。
 *
 * `react` 的入口是 `module.exports = require('./cjs/react.development.js')`，rolldown 静态分析不出具名
 * 导出，产物只剩 `export default …`——而浏览器侧要 `import { Fragment } from "react"`，于是**整个 import
 * 阶段就失败**（入口一行都执行不了）。ESM 的导出必须**静态可枚举**（不能 `export * from` 一个运行期对象），
 * 所以这里求值入口拿到它的键，生成一份把它们写成 `export const` 的包装文件，拿包装文件当入口。
 *
 * @returns 包装文件路径；入口不是 CJS、或求值拿不到键时 undefined（保持原样）。
 */
async function cjsShimOf(options: {
  name: string;
  exportName: string;
  entry: string;
  outDir: string;
}): Promise<string | undefined> {
  const source = await readFile(options.entry, "utf8").catch(() => "");
  // 判据是**CJS 入口**：`.js`/`.cjs` 且源码里真的在赋值 `module.exports` / `exports.x`（`react` 的入口是
  // `module.exports = require('./cjs/…')`）。TS 源码不在此列——那是 ESM；按"含 `exports.` 子串"判断会把
  // 注释里的 `re-exports.` 也当成 CJS，反过来给一份纯 ESM 加 `import mod from …` 而构建失败。
  const isCjsEntry =
    /\.(?:cjs|js)$/u.test(options.entry) &&
    /(?:^|\n)\s*(?:module\.exports\s*=|exports\.[A-Za-z_$][A-Za-z0-9_$]*\s*=)/u.test(source);
  if (!isCjsEntry) return undefined;
  let keys: string[];
  try {
    // 求值才知道键：CJS 的导出面是**运行期**的（静态分析只能看到 `module.exports = require(…)`）。
    const loaded = createRequire(options.entry)(options.entry) as Record<string, unknown> | undefined;
    keys = Object.keys(loaded ?? {});
  } catch {
    // 求值有副作用、或本来就是不能在 node 里加载的东西：宁可只有 default 导出，也不要让构建挂掉。
    return undefined;
  }
  const named = keys.filter((key) => key !== "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key));
  if (named.length === 0) return undefined;
  const file = join(options.outDir, `${options.exportName.replaceAll("/", "+")}.cjs-shim.mjs`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    [
      `import mod from ${JSON.stringify(options.entry)};`,
      // 用**计算属性**读：`mod.jsxDEV` 这种静态属性访问会被 rolldown 按它对 CJS 命名空间的静态理解
      // 摇成 `void 0`（`react/jsx-dev-runtime` 就那么被摇空了，页面报 `jsxDEV is not a function`）。
      "const __cjs = mod ?? {};",
      "export default __cjs;",
      ...named.map((key) => `export const ${key} = __cjs[${JSON.stringify(key)}];`),
      "",
    ].join("\n"),
    "utf8",
  );
  process.stderr.write(`[bundle-cjs] ${options.name}/${options.exportName}: 补 ${String(named.length)} 个具名导出\n`);
  return file;
}

/**
 * CSS 入口的包装：**样式文件不能直接当入口**——vite 的库模式固定 `cssCodeSplit: false`，遇到
 * `rolldownOptions.input` 里有 `.css` 直接报错。包一层 side-effect import，让样式插件按它一贯的方式
 * 把它编成"注入 `<style>`"的模块。
 *
 * @returns 包装文件路径；入口不是 CSS 时 undefined。
 */
async function cssShimOf(options: {
  exportName: string;
  entry: string;
  outDir: string;
}): Promise<string | undefined> {
  if (!options.entry.endsWith(".css")) return undefined;
  const file = join(options.outDir, `${options.exportName.replaceAll("/", "+")}.css-shim.mjs`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `import ${JSON.stringify(options.entry)};\n`, "utf8");
  return file;
}

/**
 * 确保该包的产物在（指纹没变、且**这次要的出口**都在就直接用）。
 *
 * 缓存是**按包聚合**的（一个包一个目录、出口各有自己的产物文件），而构建**按请求触发单出口**——
 * 所以命中判据必须带上"这次要的出口在不在"：只比指纹会把"先请求 `zustand/middleware`、再请求
 * `zustand/vanilla`"判成命中，第二个出口就 404 了。指纹变了才丢掉旧目录重来，否则增量合并。
 *
 * **同一个包的构建排队串行**：产物目录是包级共享的（还会被重建时清理），并发跑会互相删掉对方的产物——
 * 首屏那几十个请求是同时在飞的，`zustand/vanilla` 与 `zustand/shallow` 撞在一起就丢产物、页面 404。
 *
 * @param options - 见 {@link BundleOptions}。
 * @returns 产物映射；`input` 为空时 undefined。
 */
/**
 * 摆正 **cwd** 之后再进构建。
 *
 * rolldown 的 oxc 转译是**按 cwd 往上找 tsconfig** 拿 `experimentalDecorators` 的，而这条链跑在宿主
 * 进程里——cwd 是宿主的（dev 是工作区、打包是 profile）。不摆正，上游用 cordis 装饰器的包就会在产物里
 * 留着 `@Remote(...)`，浏览器报 `SyntaxError`、入口整条不执行（这是"不同工作目录行为不一致"里最隐蔽的一处）。
 * 跑完恢复，别把进程的 cwd 改坏了。
 */
export async function bundlePackage(options: BundleOptions): Promise<Bundled | undefined> {
  const previousCwd = process.cwd();
  if (previousCwd !== options.repoRoot) process.chdir(options.repoRoot);
  try {
    return await bundlePackageInRoot(options);
  } finally {
    if (process.cwd() !== previousCwd) process.chdir(previousCwd);
  }
}

async function bundlePackageInRoot(options: BundleOptions): Promise<Bundled | undefined> {
  const key = cacheKeyOf(options.name, options.version);
  // 同一个包**排队**：产物目录包级共享，而"这次要的出口"可能已经在上一轮里产出（第二个请求跑到
  // `bundlePackageOnce` 开头就会命中缓存，不会重建）。
  const previous = building.get(key) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(() => withBuildSlot(() => bundlePackageOnce(options, key)));
  building.set(key, task);
  try {
    // **排队要等它做完，但不能无限等**：首屏那几十个请求都在飞，同包的后来者排在队里是正常的；可要是
    // 一次构建卡死（原生绑定、磁盘），排队的人就永远挂在 pending——浏览器那边看不出所以然。超时如实抛。
    return await withTimeout(task, BUILD_TIMEOUT_MS, `${options.name}@${options.version} 构建超时`);
  } finally {
    if (building.get(key) === task) building.delete(key);
  }
}

/**
 * 同时在跑的构建数上限。
 *
 * 每次联邦构建都是一次完整的 vite build（自建实例、加载插件、跑 rolldown），首屏那两百多个包**一起上**
 * 只会互相拖慢、把内存吃满——排队反而更快。要调就设 `DSH_BUNDLE_CONCURRENCY`。
 */
const MAX_CONCURRENT_BUILDS = Math.max(1, Number(process.env["DSH_BUNDLE_CONCURRENCY"] ?? 8));
let runningBuilds = 0;
const buildQueue: (() => void)[] = [];

/** 排队/构建的等待上限：等它做完，但不无限等（卡死的构建要如实报出来，而不是让请求挂在 pending）。 */
const BUILD_TIMEOUT_MS = Math.max(1_000, Number(process.env["DSH_BUNDLE_TIMEOUT_MS"] ?? 180_000));

/** 给一个 promise 加超时；超时如实抛，不返回兜底值。 */
async function withTimeout<T>(work: Promise<T>, ms: number, subject: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${subject}（超过 ${String(ms)}ms）`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function withBuildSlot<T>(work: () => Promise<T>): Promise<T> {
  if (runningBuilds >= MAX_CONCURRENT_BUILDS) {
    await new Promise<void>((resolve) => buildQueue.push(resolve));
  }
  runningBuilds += 1;
  try {
    return await work();
  } finally {
    runningBuilds -= 1;
    buildQueue.shift()?.();
  }
}

/** 排队中/在跑的包级构建（键是缓存目录名）。 */
const building = new Map<string, Promise<Bundled | undefined>>();

async function bundlePackageOnce(options: BundleOptions, key: string): Promise<Bundled | undefined> {
  const wanted = Object.keys(options.input);
  process.stderr.write(`[bundle-in] ${options.name}: input=${wanted.join(",")} cache=${options.cacheRoot}\n`);
  if (wanted.length === 0) return undefined;
  const outDir = join(options.cacheRoot, key);
  const manifestPath = join(outDir, ".files.json");
  process.stderr.write(`[bundle-rev] ${options.name}: hash-start watch=${options.watch.join(",")}\n`);
  const rev = `${BUNDLER_REV}:${await fingerprint(options.watch)}`;
  process.stderr.write(`[bundle-rev] ${options.name}: hash=${rev}\n`);
  const cached = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "{}")) as {
    rev?: string;
    files?: Record<string, string>;
  };
  const fresh = cached.rev === rev;
  const files = fresh ? { ...cached.files } : {};
  if (fresh && wanted.every((name) => name in files)) {
    return { rev, files: new Map(Object.entries(files)) };
  }

  // **同一份配置**：CSS / 资产 / `?raw` / node 内置替身与 dev 用的是同一个插件；只有 alias 由调用方给。
  // 资产走 `threshold`：产品是我们自己落盘、自己服务的，大图产出独立文件即可，不必塞进 JS 里当 base64。
  const plugins: (PluginOption | Plugin)[] = [
    // alias：rolldown 的 `resolve.alias` 只吃"字符串 → 字符串"的对象，而我们的 alias 带正则
    // （`^@/`）——用一个最小插件表达，放在最前面（它相当于 vite 里 `enforce: "pre"` 的那一层）。
    {
      name: "dsh-alias",
      resolveId: (source: string): string | undefined => {
        for (const { find, replacement } of options.alias) {
          if (typeof find === "string" ? source.startsWith(find) : find.test(source)) {
            return source.replace(find, replacement);
          }
        }
        return undefined;
      },
    },
    browserProcessPlugin(),
    cssInlinePlugins({ name: key, assets: "threshold" }),
    clientAssetPlugin({ assets: "threshold" }),
    // 外置**全部裸说明符**（`node:*` 除外——它走 `clientAssetPlugin` 的浏览器替身）。
    //
    // 这件事交给这个内置插件而不是顶层 `external`：CJS 模块 `require` 一个外置依赖时，rolldown 默认保留
    // `require` 语义（产物里是运行期必抛的 `__require(...)`——浏览器没有 `require`），而这个插件把这类
    // require 转成 ESM import。它**必须独占**外置名单：顶层 `external` 一旦也列了同一个模块，它就整块跳过，
    // 产物里又留下 `require`。
    // **外置名单 = 包名**：凡是"一个包"（有自己的 `package.json`）就独立成联邦产物，地址由 `output.paths`
    // 交给 `urlOf`；不是包的（相对路径、内置、虚拟模块）留在产物里内联。
    //
    // 名单就是手里那张"包名 → 版本"表的键——它本来就是"这条链认识哪些包"这份事实。写成 `^名(/|$)`：
    // 既覆盖子路径引用（`katex/dist/katex.min.css`），又不会把 `node:fs`、`./x` 误判成包。
    //
    // 名单只有这一个 home：顶层 `external` 不能再列同一个模块（插件会整块跳过，产物里留下 `__require`）。
    esmExternalRequirePlugin({
      // **外置名单 = 这条链认识的那些包**（包名 → 版本表的键），node 内置除外（它们走替身）。
      // 不是包的（相对路径、内置、虚拟模块）留在产物里内联。
      external: [...(options.versions?.keys() ?? [])]
        .filter((name) => !NODE_BUILTIN.test(name))
        .map((name) => barePackageRegExp(name)),
    }),
  ];
  const startedAt = Date.now();
  process.stderr.write(`[bundle-build] ${options.name}: rolldown start\n`);
  // 入口补偿：CJS 要带具名导出的包装；CSS 不能直接当入口（vite 的库模式 `cssCodeSplit: false`，
  // 明确拒绝 `rolldownOptions.input` 里出现 CSS 文件），包一层 side-effect import 让样式插件处理它。
  const input: Record<string, string> = {};
  for (const [exportName, entry] of Object.entries(options.input)) {
    input[exportName] =
      (await cjsShimOf({ name: options.name, exportName, entry, outDir })) ??
      (await cssShimOf({ exportName, entry, outDir })) ??
      entry;
  }
  // **直接跑 rolldown**（不经过 `vite build`）：插件本来就是 rolldown 的接口，而 vite 在这条路上只提供了
  // lib 模式的入口/输出命名与 `worker.format`——那几项自己写更直接，且 `build.rolldownOptions` 里的
  // `transform` / `resolve` 也不会再被 vite 吞掉（对照表见债文档，那份债随这次改动一起销）。
  const bundle = await rolldown({
    input,
    plugins,
    // **不指 tsconfig**：装饰器由下面的 `transform.decorator.legacy` 直接开（直出时它生效，见对照表）。
    // rolldown 自己会解析 tsconfig（含 `extends`，实测过），所以两种形态各指一处不如一处都不指。
    ...(options.tsconfig === undefined ? {} : { resolve: { tsconfigFilename: options.tsconfig } }),
    transform: {
      // **浏览器 baseline**（vite 8 的默认那组：Chrome 111 / Edge 111 / Firefox 114 / Safari 16.4）。
      // 直出后没有 `build.target: "baseline-widely-available"` 那层展开，这里自己写全。不要图省事写
      // `esnext` 或留空——目标一低，oxc 就给类字段、可选链这些逐个加降级 helper，产物里全是奇怪的垫片。
      target: ["chrome111", "edge111", "firefox114", "safari16.4"],
      // 装饰器：legacy（cordis 与上游用的就是这套）。有 tsconfig 时它会被那份覆盖，这里是默认。
      decorator: { legacy: true },
      // 浏览器没有 `process`：精确替换 `process.env`，裸 `process` 再给一个空壳——`immer` 这类包会在
      // 模块顶层读它，漏掉就是一个 `process is not defined` 把整份产物带下去。
      define: {
        "process.env": "{ env: {} }",
        process: "{ env: {} }",
      },
    },
  });
  const { output: items } = await bundle.generate({
    format: "es",
    // 出口名可以含 `/`（子路径出口：`helpers/decorate`），rolldown 会建父目录。
    entryFileNames: "[name].js",
    // 拆出来的块落**自己的前缀**（与资产 `assets/` 并列）：它们不是"包的出口"——出口名要回源码里找目标，
    // 而块没有源码对应（`src/chunk-abc.js` 不存在）。与出口共用一段 URL，服务端就只能把它当出口、落空。
    chunkFileNames: "chunks/[name]-[hash].js",
    // **拆分的下限**：`import()` 该拆就拆（动态加载是它的价值），但"被某个包静态共享的小模块"不值得各自
    // 一次请求——`@shikijs/langs` 那种按语言一个文件能把产物切成几千块（实测 3092），而这条链是按包产出、
    // 浏览器按需取的，每块都是一次请求。小于 `minSize` 的不单拆（并进引用它的产物）；只被一个入口用的也不拆
    // （拆了纯粹多一次请求）。
    advancedChunks: {
      minSize: 20_000,
      minShareCount: 2,
    },
    // 资产统一落在 `assets/` 下、带内容 hash：路由按这个前缀把它们当文件吐，
    // 出口产物与资产不混在一个命名空间里。
    assetFileNames: "assets/[name]-[hash][extname]",
    // 外置说明符 → 联邦地址（`/@client-modules/<pkg>@<ver>/…`）。
    paths: (id: string) => urlOf(id, options),
  });
  await bundle.close();
  process.stderr.write(`[bundle-build] ${options.name}: rolldown done ms=${String(Date.now() - startedAt)}\n`);

  if (!items.some((item) => item.type === "chunk")) {
    process.stderr.write(
      `[bundle] ${options.name}: 输出为空（input=${wanted.join(",")} outputs=${String(items.length)}）\n`,
    );
    return undefined;
  }
  // 指纹没变就**增量合并**：别的出口的产物还在磁盘上、还在 manifest 里，删了就得让它们重新构建一次。
  //
  // 指纹变了也**不整目录删**：这个缓存是**跨进程共用**的（同时跑 `dev --web` 与桌面 dev 是常态），删掉整个
  // 目录会把另一个进程刚写的产物一起带走，表现为偶发 404。产物名本身带语义（出口名 / 资产 hash），直接
  // 覆盖即可；旧的字节留在盘上不碍事。
  await mkdir(outDir, { recursive: true });
  for (const item of items) {
    if (item.type !== "chunk") continue;
    // 出口名可以含 `/`（子路径出口：`helpers/decorate`），落盘要先把父目录建出来。
    await mkdir(dirname(join(outDir, item.fileName)), { recursive: true });
    await writeFile(join(outDir, item.fileName), item.code, "utf8");
    // **出口产物**按出口名进清单（路由按出口名找它）；**拆出来的块**（`import()` 各成 chunk）按文件名——
    // 引它的产物写的就是那个名字（`./chunk-<hash>.js`），它没有第二个身份。只记出口名的话这些块不在清单里，
    // 路由按清单服务就 404，浏览器报 "does not provide an export named …"。
    files[item.isEntry ? item.name : item.fileName] = `${key}/${item.fileName}`;
  }
  // 资产也进清单（键就是它在包内的相对路径 `assets/<name>-<hash>.<ext>`）：清单是"这个包产出里有什么"
  // 的**唯一真相**——路由按它服务资产，缓存命中/增量合并也照它判断，不必去猜目录里躺了什么。
  for (const asset of items) {
    if (asset.type !== "asset") continue;
    await mkdir(dirname(join(outDir, asset.fileName)), { recursive: true });
    await writeFile(join(outDir, asset.fileName), asset.source ?? "");
    files[asset.fileName] = `${key}/${asset.fileName}`;
  }
  await writeFile(manifestPath, `${JSON.stringify({ rev, files }, null, 2)}\n`, "utf8");
  // 指纹进地址用的表（{@link revs}）：**每次构建后更新**——同一会话里后构建的产物引用它时就能带上
  // 当前指纹（浏览器于是可以长缓存那一份）。
  //
  // 这样会自然产生"同一个包的两种 URL"（上一轮落盘的产物写的是旧指纹、这一轮写的是新指纹）——**不要紧**：
  // 服务端对指纹不匹配的请求一律**重定向到当前指纹**（见 `serveFederation`），所有引用最终落到同一个 URL，
  // 不会出现两份模块实例（那才是致命的：react 会报 `Cannot read properties of null (reading 'useContext')`）。
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

// 联邦产物（`/_zephyr/@modules/...`）：按请求产出、按包缓存。
// 重写自旧 `plugin.ts` 的 `serveFederation`：不再依赖 `apply` 的闭包，所有输入来自 `AppEnv` / `WebServer`。
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { Federation, type FederationConfig } from "./federation.contract.ts";
import { fileInPackage, manifestOf, packageRootOf } from "../internal/resolve.ts";
import { nodeStubPathOf } from "../internal/package-root.ts";
import {
  BUNDLER_REV,
  CLIENT_MODULES_CACHE_NAMESPACE,
  contentRev,
  CLIENT_MODULES_PREFIX,
  browserEntryOf,
  bundlePackage,
  clientModulesAlias,
  dependencyEntry,
} from "./bundle.ts";
import { parseFederationUrl } from "./parse-url.ts";
import { watchOf } from "./watch.ts";

/** 从某个文件向上找最近的 `package.json`（node 解析的基准就是它所在的包）。 */
async function nearestManifest(file: string | undefined): Promise<string | undefined> {
  if (file === undefined) return undefined;
  let directory = dirname(file);
  for (;;) {
    const candidate = join(directory, "package.json");
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
}

/** 资产扩展名 → MIME（产物里的 `assets/<name>-<hash>.<ext>`）。 */
const ASSET_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  css: "text/css; charset=utf-8",
  json: "application/json",
};

@Injectable()
export class FederationDefault extends Federation {
  /** 预构建的开关与范围：**配置落在构造参数上**（`configure` 用它推导，类字段初值收不到覆盖）。 */
  readonly config: FederationConfig;

  /**
   * @param config - 装配面的配置。
   */
  constructor(config: Partial<FederationConfig> = {}) {
    super();
    this.config = { dev: { include: config.dev?.include ?? ["@morlay/*"] } };
  }

  private readonly appEnv = inject(AppEnv);

  /**
   * 联邦缓存的根：**只**落在 `<cacheDir>/client-modules` 这一层命名空间下。
   *
   * 直接写 `cacheDir` 会让包名目录（`@scope+name@version`）散落在缓存根上，与别的用途混在一起；
   * 命名空间化之后，缓存根下只有可枚举的几个目录，整目录删也只影响一个用途。
   * @returns 该用途的缓存根。
   */
  private get cacheRoot(): string {
    return this.appEnv.cacheDirOf(CLIENT_MODULES_CACHE_NAMESPACE);
  }

  private readonly logger = inject(Logger);

  /** `depsUrl` 解析到的包根（`<name>@<version>` → root）：`serve` 时复用，不再重新解析。 */
  private readonly roots = new Map<string, string>();

  async serve(url: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const target = parseFederationUrl(url);
    if (target === undefined) return false;
    const { name, urlVersion, file } = target;
    const rootKey = `${name.replaceAll("/", "+")}@${urlVersion}`;
    // **包根只用 Node 的解析规则**：先问「本会话见过的包」（它们是引用方），再问应用清单。
    // 不猜包管理器的布局（`.pnpm` 那类）：换 yarn / npm 就不成立，而 Node 的解析跨包管理器成立。
    const root =
      this.roots.get(rootKey) ??
      (await this.importerRootOf(name)) ??
      (await this.rootOf(name));
    // 定位到的包根记下来：同一个包的后续请求不必再解析一遍。
    if (root !== undefined) this.roots.set(rootKey, root);
    const resolvedManifest = root === undefined ? undefined : await manifestOf(root);
    // 版本只用来**校验**（不参与定位）：地址里那段与清单对不上就是构建期与请求期的事实分叉了。
    if (resolvedManifest?.version !== undefined && resolvedManifest.version !== urlVersion) {
      return this.miss(
        res,
        req,
        `${name}@${urlVersion}/${file} — 解析到的副本是 ${resolvedManifest.version}（${String(root)}），与地址里的版本不一致`,
      );
    }
    const version = resolvedManifest?.version ?? urlVersion;
    const key = `${name.replaceAll("/", "+")}@${version}`;
    // 产物里的资产/块：按清单（`.files.json`）取，文件名带内容 hash → 长缓存。
    if (file.startsWith("assets/") || file.startsWith("chunks/")) {
      return await this.replyFile(key, file, req, res);
    }
    // 只去掉 `.js` 后缀，**保留目录段**：`shim/with-selector.js` → `shim/with-selector`。
    // 截成 `with-selector` 会让解析退到主入口（现象：缓存里是 66KB 的 shim/index.js）。
    const exportName = file.endsWith(".js") ? file.slice(0, -3) : file;
    // **入口先解析**：缓存是否新鲜要用「和构建同一套输入」算指纹（`watchOf(root, entry)`），
    // 而输入集取决于入口。解析不到入口时退回旧口径（只看规则版本），保持"缓存命中但包根未知"
    // 那条路（第三方传递依赖）仍然能服务。
    const entry = await this.entryOf(name, root, exportName);
    const watch = entry === undefined ? undefined : watchOf(root, entry);
    const expectedRev = watch === undefined ? undefined : await contentRev(watch);
    // **缓存优先**：prebundle 已经产出过这个出口（`<cache>/client-modules/<pkg>@<ver>/.files.json`）就直接回文件。
    const hit = await this.cachedManifest(key, exportName, expectedRev);
    if (hit !== undefined) {
      // **命中也要重放包根表**：产物里的联邦地址是构建期写死的，而浏览器逐个按地址来取时，
      // 那些「运行期按名拼出来的说明符」（`@shikijs/langs/<lang>`）本会话从没构建过——没有
      // `resolved` 重放，`rootOf` 从应用清单出发解析不到它们（pnpm 严格布局下它们不在应用自己的
      // `node_modules` 里），请求就成了一条 404。
      for (const [dep, depVersion, depRoot] of hit.resolved ?? []) {
        this.roots.set(`${dep.replaceAll("/", "+")}@${depVersion}`, depRoot);
      }
      const repliedFromCache = await this.replyFile(key, exportName, req, res);
      if (repliedFromCache) return true;
    }
    if (root === undefined) {
      // **不静默 404**：包根解析不到是「构建期写了一条地址、运行时却没有人能解释它」，
      // 报清楚从哪儿解析过、要去看什么；404 会让排查的人以为是文件没打。
      return this.miss(
        res,
        req,
        `${name}@${urlVersion}/${file} — 从引用方（本会话见过的 ${String(this.roots.size)} 个包）与应用清单 ${this.appEnv.profileManifest} 都解析不到包根`,
      );
    }
    if (entry === undefined) {
      return this.miss(res, req, `${name}@${urlVersion}/${exportName} — 包根解析到了，但这个出口解析不出入口`);
    }
    const bundled = await bundlePackage({
      cacheRoot: this.cacheRoot,
      repoRoot: this.appEnv.values.profileDir,
      // 与 dev 侧同一套解析约定：`@/…` → 仓库根、`node:*` → 求值安全的替身（CJS 形态，rolldown 直出）。
      alias: clientModulesAlias({
        repoRoot: this.appEnv.values.profileDir,
        nodeStub: nodeStubPathOf(),
      }),
      // `node:*` 的浏览器替身：`clientAssetPlugin` 的 `resolveId` 是 `order: "pre"`，它先于 alias 命中，
      // 所以必须**同时**作为 `BundleOptions` 的字段传下去（只给 alias 的话插件仍用自己的默认路径）。
      nodeStub: nodeStubPathOf(),
      name,
      version,
      input: { [exportName]: entry },
      watch: watch ?? watchOf(root, entry),
      appManifest: this.appEnv.profileManifest,
      log: (message) => this.logger.debug(message),
      ...(root === undefined ? {} : { manifestOf: join(root, "package.json") }),
      // 产物内部解析到的外部依赖也记进包根表（浏览器随后按地址来取时要用）。
      onResolved: (dep, depVersion, depRoot) => {
        // **优先用仓库根那份**：pnpm 会给每个依赖方各放一份嵌套副本
        // （`…/dsh-token-meter/node_modules/@deepseek-ai/dsh-session`），产物按包名寻址时
        // 认到嵌套那份就等于同一个包出现多个 URL——浏览器请求它永远等不到响应（`[bundle-skip]`）。
        this.roots.set(`${dep.replaceAll("/", "+")}@${depVersion}`, depRoot);
      },
    }).catch((error: unknown) => {
      // 打包失败必须**看得见**：`bundle-skip` 只是结果，原因在这里。走 warn 会被日志级别吞掉，
      // 现象就变成「浏览器请求一个模块永远等不到响应」。
      console.error(`[bundle-failed] ${name}@${version} root=${String(root)}\n`, error);
      return undefined;
    });
    if (bundled === undefined) {
      console.error(
        `[bundle-skip] ${name}@${version} root=${String(root)} entry=${String(entry)}\n`,
      );
      return false;
    }
    // 清单的键是**出口名**（`client`），值是 `<key>/client.js`。
    const manifestKey = [exportName, "client", "index"].find((name) => bundled.files.has(name));
    if (manifestKey === undefined) {
      console.error(`[bundle-empty] ${name} files=[${[...bundled.files.keys()].join(",")}]\n`);
      return false;
    }
    const replied = await this.replyFile(key, manifestKey, req, res);
    if (!replied) console.error(`[reply-miss] ${key} ${manifestKey}\n`);
    return replied;
  }

  /** 裸说明符 → 联邦地址：`<pkg>` 或 `<pkg>/<subpath>`（三方与聚合包都走这条链）。 */
  async depsUrl(specifier: string, importer?: string): Promise<string | undefined> {
    const match = /^((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/u.exec(specifier);
    if (match === null) return undefined;
    const [, name, subpath] = match;
    if (name === undefined) return undefined;
    // 从**引用方**解析（node 的规则）：从 importer 向上找最近的 `package.json`——它的依赖树才是这个
    // 说明符的可见面（pnpm 严格布局下 `react-dom` 的 `scheduler` 只在自己的 node_modules 里）。
    const from = await nearestManifest(importer);
    const root = await this.rootOf(name, from);
    // 答不上来 = 这个裸说明符会退回 vite 的文件链（浏览器里出现 `/@fs/…/node_modules/…`）。这条是
    // **debug**：正常路径不该有它，出现即判据漏了一个包，得能看得见。
    if (root === undefined) {
      this.logger.debug("[prebundle-miss] %s ← %s", specifier, importer ?? "(no importer)");
      return undefined;
    }
    const version = (await manifestOf(root))?.version;
    if (version === undefined) return undefined;
    // 记下包根：随后浏览器按这个地址来取产物时，`serve` 不用再解析一次（pnpm 的传递依赖只有这里有）。
    this.roots.set(`${name.replaceAll("/", "+")}@${version}`, root);
    // 子路径同样是这条链的出口（`react/jsx-runtime` → `.../react@18.3.1/jsx-runtime.js`）。
    const file = subpath === undefined ? "index.js" : `${subpath}.js`;
    // **必须与产物里的地址同形**（含 `?v=` 构建世代）：同一份 react 若一个地址带 `?v=`、一个不带，
    // 浏览器会当成两个模块、加载两份实例——hooks dispatcher 就分家了（`useContext` 读 null）。
    return `${CLIENT_MODULES_PREFIX}/${name.replaceAll("/", "+")}@${version}/${file}?v=${BUNDLER_REV}`;
  }

  /**
   * 包名 → 包根：**Node 的 ESM 解析**，与枚举（`planPrebundle`）、解析面（`internal/resolve`）
   * 同一份实现（{@link packageRootOf}）——不再有第二套规则。
   *
   * 不拼 `createRequire`：那是 CJS 的条件与路径语义（虚拟模块 id、`/@…` 都不是文件路径，且 `exports`
   * 只写 `"./index.js"` 的包会一律 `ERR_PACKAGE_PATH_NOT_EXPORTED`）；也不猜包管器的布局（`.pnpm` 那类
   * 换 yarn / npm 就不成立）。
   * @param name - 包名。
   * @param from - 解析基准（引用方的清单/文件）；缺省用应用清单。
   * @returns 包根；解析不到时 undefined。
   */
  private async rootOf(name: string, from?: string): Promise<string | undefined> {
    const found = await packageRootOf(from ?? this.appEnv.profileManifest, name);
    return found?.root;
  }
  /**
   * 出口名 → 入口文件：**出口 → 入口只有一份规则**（`browserEntryOf`：`exports` 的浏览器条件 +
   * 存在性校验 + 物理回退），与枚举侧（`prebundle-plan`）同一份。
   *
   * 不能按**包名**解析（`createRequire(<包清单>).resolve(exportName)`）：出口名与 npm 包名可以撞——
   * `@shikijs/langs` 的出口 `./typescript` 会解析到无关的 `typescript` 包（整份 TS 编译器），它的默认
   * 导出没有 `scopeName`，shiki 构造 Registry 时就 `Cannot read properties of undefined (reading 'split')`。
   * @param name - 包名。
   * @param root - 包根（未知时按引用方解析说明符）。
   * @param exportName - 出口名（`index` = 根出口）。
   * @returns 入口绝对路径；解析不出来时 undefined。
   */
  private async entryOf(
    name: string,
    root: string | undefined,
    exportName: string,
  ): Promise<string | undefined> {
    if (root === undefined) {
      // 包根未知时也要按子路径解析：`dependencyEntry` 走 ESM 解析（尊重 exports 与文件路径），
      // 先试 `${name}/${exportName}`（`shim/with-selector` 这种），失败才退回主入口。
      if (exportName !== "index") {
        const subpath = await dependencyEntry(
          this.appEnv.profileManifest,
          `${name}/${exportName}`,
        ).catch(() => undefined);
        if (subpath?.entry !== undefined) return subpath.entry;
      }
      return (await dependencyEntry(this.appEnv.profileManifest, name).catch(() => undefined))
        ?.entry;
    }
    // 出口名的回退：`index` → 根出口；其余先按名找，再按我们的约定找 `./client-module`。
    return (
      (await browserEntryOf(root, exportName === "index" ? undefined : exportName)) ??
      (await browserEntryOf(root, "client-module")) ??
      (await fileInPackage(root, exportName))
    );
  }

  /**
   * 从**引用方**解析包根（Node 的解析规则）：本会话已经见过的那些包，逐个拿它们自己的清单当基准。
   *
   * 为什么引用方优先：pnpm 的严格布局下传递依赖只对**声明它的那个包**可见，而冷请求里「谁引用它」
   * 的唯一来源就是本会话已经服务过的包（它们的产物里写着这条地址）。
   *
   * 「从引用方解析」这件事只有一份实现（{@link packageRootOf}，内部是 Node 的 ESM 解析栈）：不拼
   * `createRequire(...).resolve('<name>/package.json')`——它要求包把 `./package.json` 写进 `exports`
   * （`@shikijs/langs` 就没写），同一个语义却会失配。
   * @param name - 包名。
   * @returns 包根；从所有引用方都解析不到时 undefined。
   */
  private async importerRootOf(name: string): Promise<string | undefined> {
    for (const importer of new Set(this.roots.values())) {
      // 与枚举/解析面同一份：`packageRootOf` 内部就是 Node 的 ESM 解析栈（`findPackageJSON`）。
      const found = await packageRootOf(join(importer, "package.json"), name);
      if (found !== undefined) return found.root;
    }
    return undefined;
  }

  /**
   * 一条**带上下文**的解析失败：写日志，也回给浏览器（**500**，不是 404）。
   *
   * 404 说的是「这个文件不存在」，而这里的真相是「构建期写了一条地址，运行期没有基准能解释它」——
   * 两者要改的东西不同，状态码与正文因此都要分开。
   * @param res - 响应。
   * @param req - 请求（HEAD 不回正文）。
   * @param detail - 现场（地址、解析基准、版本）。
   * @returns true（已应答）。
   */
  private miss(res: ServerResponse, req: IncomingMessage, detail: string): true {
    const message = `federation-miss: ${detail}`;
    console.error(`${message}\n`);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : `${message}\n`);
    return true;
  }

  /**
   * 缓存里有没有这个出口的产物（且世代对得上）。
   *
   * 回的是**产物清单**而不是布尔：命中时调用方要把 `resolved`（外部依赖的包根表）重放回
   * {@link roots}，否则本会话没构建过的包会解析不到（见 `serve` 里的说明）。
   * @param key - `<pkg>@<ver>`（已编码）。
   * @param exportName - 出口名（`vanilla` / `index` …）。
   * @param expectedRev - 期望指纹（包根未知时 undefined：只比规则版本）。
   * @returns 产物清单；未命中时 undefined。
   */
  private async cachedManifest(
    key: string,
    exportName: string,
    expectedRev: string | undefined,
  ): Promise<
    | { rev?: string; files?: Record<string, string>; resolved?: Array<[string, string, string]> }
    | undefined
  > {
    const raw = await readFile(join(this.cacheRoot, key, ".files.json"), "utf8").catch(
      () => undefined,
    );
    if (raw === undefined) return undefined;
    const manifest = JSON.parse(raw) as {
      rev?: string;
      files?: Record<string, string>;
      resolved?: Array<[string, string, string]>;
    };
    if (manifest.rev === undefined) return undefined;
    // **有入口时按完整指纹判**（规则版本 + 源码内容）：workspace 包的版本号是固定的 `0.0.1`，
    // 只比规则版本会让"同版本改了源码"继续复用旧产物（症状：模块里没有新加的导出）。
    // 没有入口时（第三方传递依赖、包根未知）退回规则版本口径——registry 版本的内容不可变。
    if (expectedRev === undefined) {
      if (!manifest.rev.startsWith(BUNDLER_REV)) return undefined;
    } else if (manifest.rev !== expectedRev) {
      return undefined;
    }
    const relative = manifest.files?.[exportName];
    if (relative === undefined) return undefined;
    const present = await readFile(join(this.cacheRoot, relative)).catch(() => undefined);
    return present === undefined ? undefined : manifest;
  }

  /** 按清单里的相对路径回一个文件（资产/块/出口产物同一套）。 */
  private async replyFile(
    key: string,
    file: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    // 产物清单的键是 `<pkg>@<ver>/<file>`（资产/块也在这个前缀下）；文件本身在缓存根。
    const manifest = JSON.parse(
      await readFile(join(this.cacheRoot, key, ".files.json"), "utf8").catch(() => "{}"),
    ) as { files?: Record<string, string> };
    const relative = manifest.files?.[file] ?? `${key}/${file}`;
    const bytes = await readFile(join(this.cacheRoot, relative)).catch(() => undefined);
    if (bytes === undefined) return false;
    // 用**真实文件名**判 MIME（清单键 `client`/`index` 没有扩展名）。
    const extension = relative.slice(relative.lastIndexOf(".") + 1).toLowerCase();
    res.writeHead(200, {
      "content-type":
        extension === "js"
          ? "text/javascript; charset=utf-8"
          : (ASSET_MIME[extension] ?? "application/octet-stream"),
      "cache-control": "public, max-age=31536000, immutable",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
    return true;
  }
}
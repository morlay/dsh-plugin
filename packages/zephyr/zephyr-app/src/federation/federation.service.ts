// 联邦产物（`/_zephyr/@modules/...`）：按请求产出、按包缓存。
// 重写自旧 `plugin.ts` 的 `serveFederation`：不再依赖 `apply` 的闭包，所有输入来自 `AppEnv` / `WebServer`。
import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { AppEnv } from "../app-env/app-env.contract.ts";
import { exportTargetOf, fileInPackage, manifestOf } from "../internal/resolve.ts";
import {
  BUNDLER_REV,
  CLIENT_MODULES_CACHE_NAMESPACE,
  contentRev,
  CLIENT_MODULES_PREFIX,
  bundlePackage,
  clientModulesAlias,
  dependencyEntry,
} from "./bundle.ts";
import { parseFederationUrl } from "./parse-url.ts";
import { createRequire } from "node:module";
import { watchOf } from "./watch.ts";
import { Federation, type FederationConfig } from "./federation.contract.ts";

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
    const root =
      this.roots.get(`${name.replaceAll("/", "+")}@${urlVersion}`) ?? (await this.rootOf(name));
    const version =
      (root === undefined ? undefined : (await manifestOf(root))?.version) ?? urlVersion;
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
    if (await this.cached(key, exportName, expectedRev)) {
      const repliedFromCache = await this.replyFile(key, exportName, req, res);
      if (repliedFromCache) return true;
    }
    if (entry === undefined) {
      console.error(`[federation-miss] ${name}@${urlVersion}/${exportName} root=${String(root)}`);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        req.method === "HEAD"
          ? undefined
          : `unresolved entry: ${name}@${urlVersion}/${exportName}\n`,
      );
      return true;
    }
    const bundled = await bundlePackage({
      cacheRoot: this.cacheRoot,
      repoRoot: this.appEnv.values.profileDir,
      // 与 dev 侧同一套解析约定：`@/…` → 仓库根、`node:*` → 求值安全的替身（CJS 形态，rolldown 直出）。
      alias: clientModulesAlias({
        repoRoot: this.appEnv.values.profileDir,
        nodeStub: join(this.appEnv.packageRoot, "src", "node-stub", "node-stub.cjs"),
      }),
      // `node:*` 的浏览器替身：`clientAssetPlugin` 的 `resolveId` 是 `order: "pre"`，它先于 alias 命中，
      // 所以必须**同时**作为 `BundleOptions` 的字段传下去（只给 alias 的话插件仍用自己的默认路径）。
      nodeStub: join(this.appEnv.packageRoot, "src", "node-stub", "node-stub.cjs"),
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

  /** 包名 → 包根（node 原生解析；基准是行包清单与装配根清单）。 */
  private async rootOf(name: string, from?: string): Promise<string | undefined> {
    // **引用方优先**：pnpm 下同一个名字可能同时存在多份（`use-sync-external-store` 的 1.6.0 与 1.7.0），
    // 先解析引用方看到的那份，才能拿到**实际被引用的版本**；直接拼仓库根可能命中陈旧的提升副本。
    if (from !== undefined) {
      // `findPackageJSON` 是**同步**的（ESM 解析、不受 `exports` 限制），这里包一层 try 即可。
      const fromImporter = (() => {
        try {
          return findPackageJSON(name, pathToFileURL(from));
        } catch {
          return undefined;
        }
      })();
      if (fromImporter !== undefined) return dirname(fromImporter);
    }
    const bases = [
      // 引用方的清单优先：pnpm 严格布局下，传递依赖只在自己的 node_modules 里可见。
      ...(from === undefined ? [] : [from]),
      join(this.appEnv.packageRoot, "package.json"),
      this.appEnv.profileManifest,
    ];
    for (const base of bases) {
      // **不拼 `<name>/package.json` 去 `createRequire`**：现代包（`mdast-util-gfm` 这类 syntax-tree
      // 系、`mdast-util-phrasing` 同族）的 `exports` 只写 `"./index.js"`，那样解析一律
      // `ERR_PACKAGE_PATH_NOT_EXPORTED`——明明装着也答不上来，于是插件只能 `return null`，整条链退回
      // vite 的文件服务（浏览器里出现 `/@fs/…/node_modules/.pnpm/…`，正是「该 prebundle 的包」漏成了文件）。
      // `findPackageJSON` 走 ESM 解析、直接找包清单，不受 `exports` 限制；解析面与 `internal/resolve`
      // 的 `packageRootOf` 同源。
      let found: string | undefined;
      try {
        found = findPackageJSON(name, pathToFileURL(base).href);
      } catch {
        continue;
      }
      if (found !== undefined) return dirname(found);
    }
    return undefined;
  }

  /** 出口名 → 入口文件（我们的包按 `exports`，三方按 node 的解析）。 */
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
          `${name}/${exportName}` as never,
        ).catch(() => undefined);
        if (subpath?.entry !== undefined) return subpath.entry;
      }
      return (await dependencyEntry(this.appEnv.profileManifest, name).catch(() => undefined))
        ?.entry;
    }
    // **子路径先用原生解析**：`createRequire(<包清单>).resolve(specifier)` 尊重 `exports` 条件与子路径
    // （`use-sync-external-store/shim/with-selector` 这类），不再靠我们猜扩展名。
    // 子路径就是文件（无 exports 的包）：按扩展名探测，命中即返回。
    if (exportName.includes("/")) {
      for (const candidate of [
        exportName,
        `${exportName}.js`,
        `${exportName}.cjs`,
        `${exportName}.mjs`,
      ]) {
        const file = join(root, candidate);
        if (
          await readFile(file, "utf8").then(
            () => true,
            () => false,
          )
        )
          return file;
      }
    }
    if (exportName !== "index") {
      const native = (() => {
        try {
          const resolver = createRequire(join(root, "package.json"));
          // 带扩展名的资源出口（`brand-font.css`）与无扩展名的 JS 出口都要试：
          // `serve` 拿到的 `exportName` 已去掉扩展名，直接 resolve 会落空。
          for (const candidate of [exportName, `${exportName}.css`]) {
            try {
              return resolver.resolve(candidate);
            } catch {
              continue;
            }
          }
          return undefined;
        } catch {
          return undefined;
        }
      })();
      if (native !== undefined) return native;
    }
    // 出口名的回退：`index` → 根出口；其余先按名找，再按我们的约定找 `./client-module`。
    return (
      (await exportTargetOf(root, exportName === "index" ? undefined : exportName)) ??
      (await exportTargetOf(root, "client-module")) ??
      (await fileInPackage(root, exportName))
    );
  }

  /**
   * 缓存里有没有这个出口的产物（且世代对得上）。
   * @param key - `<pkg>@<ver>`（已编码）。
   * @param exportName - 出口名（`vanilla` / `index` …）。
   * @returns 判断结果。
   */
  private async cached(
    key: string,
    exportName: string,
    expectedRev: string | undefined,
  ): Promise<boolean> {
    const raw = await readFile(join(this.cacheRoot, key, ".files.json"), "utf8").catch(
      () => undefined,
    );
    if (raw === undefined) return false;
    const manifest = JSON.parse(raw) as { rev?: string; files?: Record<string, string> };
    if (manifest.rev === undefined) return false;
    // **有入口时按完整指纹判**（规则版本 + 源码内容）：workspace 包的版本号是固定的 `0.0.1`，
    // 只比规则版本会让"同版本改了源码"继续复用旧产物（症状：模块里没有新加的导出）。
    // 没有入口时（第三方传递依赖、包根未知）退回规则版本口径——registry 版本的内容不可变。
    if (expectedRev === undefined) {
      if (!manifest.rev.startsWith(BUNDLER_REV)) return false;
    } else if (manifest.rev !== expectedRev) {
      return false;
    }
    const relative = manifest.files?.[exportName];
    if (relative === undefined) return false;
    return (await readFile(join(this.cacheRoot, relative)).catch(() => undefined)) !== undefined;
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

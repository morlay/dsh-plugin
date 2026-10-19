// 联邦产物（`/_zephyr/@modules/...`）：按请求产出、按包缓存。
// 重写自旧 `plugin.ts` 的 `serveFederation`：不再依赖 `apply` 的闭包，所有输入来自 `AppEnv` / `ClientRows`。
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { AppEnv } from "../app-env/app-env.contract.ts";
import { ClientRows } from "../rows/index.ts";
import { exportNameOfFileName, exportTargetOf, fileInPackage, manifestOf } from "../internal/resolve.ts";
import { BUNDLER_REV, CLIENT_MODULES_PREFIX, bundlePackage, clientModulesAlias, dependencyEntry } from "./bundle.ts";
import { parseFederationUrl } from "./parse-url.ts";
import { watchOf } from "./watch.ts";
import { Federation } from "./federation.contract.ts";

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
  private readonly appEnv = inject(AppEnv);

  private readonly rows = inject(ClientRows);

  private readonly logger = inject(Logger);

  /** `depsUrl` 解析到的包根（`<name>@<version>` → root）：`serve` 时复用，不再重新解析。 */
  private readonly roots = new Map<string, string>();

  async serve(url: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const target = parseFederationUrl(url);
    if (target === undefined) return false;
    const { name, urlVersion, file } = target;
    const root = this.roots.get(`${name.replaceAll("/", "+")}@${urlVersion}`) ?? (await this.rootOf(name));
    const version = (root === undefined ? undefined : (await manifestOf(root))?.version) ?? urlVersion;
    const key = `${name.replaceAll("/", "+")}@${version}`;
    // 产物里的资产/块：按清单（`.files.json`）取，文件名带内容 hash → 长缓存。
    if (file.startsWith("assets/") || file.startsWith("chunks/")) {
      return await this.replyFile(key, file, req, res);
    }
    const exportName = exportNameOfFileName(file);
    const entry = await this.entryOf(name, root, exportName);
    if (entry === undefined) {
      console.error(`[federation-miss] ${name}@${urlVersion}/${exportName} root=${String(root)}`);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : `unresolved entry: ${name}@${urlVersion}/${exportName}\n`);
      return true;
    }
    const bundled = await bundlePackage({
      cacheRoot: this.appEnv.cacheDir,
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
      watch: watchOf(root, entry),
      log: (message) => this.logger.debug(message),
      ...(root === undefined ? {} : { manifestOf: join(root, "package.json") }),
      clientRows: new Set(this.rows.rows),
      // 产物内部解析到的外部依赖也记进包根表（浏览器随后按地址来取时要用）。
      onResolved: (dep, depVersion, depRoot) => {
        // **优先用仓库根那份**：pnpm 会给每个依赖方各放一份嵌套副本
        // （`…/dsh-token-meter/node_modules/@deepseek-ai/dsh-session`），产物按包名寻址时
        // 认到嵌套那份就等于同一个包出现多个 URL——浏览器请求它永远等不到响应（`[bundle-skip]`）。
        this.roots.set(
          `${dep.replaceAll("/", "+")}@${depVersion}`,
          depRoot,
        );
      },
    }).catch((error: unknown) => {
      // 打包失败必须**看得见**：`bundle-skip` 只是结果，原因在这里。走 warn 会被日志级别吞掉，
      // 现象就变成「浏览器请求一个模块永远等不到响应」。
      console.error(`[bundle-failed] ${name}@${version} root=${String(root)}\n`, error);
      return undefined;
    });
    if (bundled === undefined) {
      console.error(`[bundle-skip] ${name}@${version} root=${String(root)} entry=${String(entry)}\n`);
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
    if (root === undefined) return undefined;
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
    // 先看装配根的 `node_modules`（依赖解析的第一站，pnpm 的软链也在这里）。
    const direct = join(this.appEnv.values.profileDir, "node_modules", name, "package.json");
    try {
      await readFile(direct, "utf8");
      return dirname(direct);
    } catch {
      // 落到 node 的解析链。
    }
    const bases = [
      // 引用方的清单优先：pnpm 严格布局下，传递依赖只在自己的 node_modules 里可见。
      ...(from === undefined ? [] : [from]),
      join(this.appEnv.packageRoot, "package.json"),
      join(this.appEnv.packageRoot, "..", "zephyr-ui", "package.json"),
      this.appEnv.profileManifest,
    ];
    for (const base of bases) {
      try {
        return dirname(createRequire(base).resolve(`${name}/package.json`));
      } catch {
        continue;
      }
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
      return (await dependencyEntry(this.appEnv.profileManifest, name).catch(() => undefined))?.entry;
    }
    // 出口名的回退：`index` → 根出口；其余先按名找，再按我们的约定找 `./client-module`。
    return (
      (await exportTargetOf(root, exportName === "index" ? undefined : exportName)) ??
      (await exportTargetOf(root, "client-module")) ??
      (await fileInPackage(root, exportName))
    );
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
      await readFile(join(this.appEnv.cacheDir, key, ".files.json"), "utf8").catch(() => "{}"),
    ) as { files?: Record<string, string> };
    const relative = manifest.files?.[file] ?? `${key}/${file}`;
    const bytes = await readFile(join(this.appEnv.cacheDir, relative)).catch(() => undefined);
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

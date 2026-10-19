// 兜底：页面由我们自己出（注入 HMR），仓库路径明确 404，其余全部交给 vite。
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { AppEnv } from "../app-env.contract.ts";
import { Federation } from "../federation/federation.contract.ts";
import { ViteHandoff } from "../vite-handoff.contract.ts";
import { WebServe } from "./serve.contract.ts";

/** 仓库路径（打包形态下不存在，放过去只会让人在几百条请求里猜）。 */
const REPO_PATH = /^\/(?:packages|vendor|apps|devpackages|node_modules)(?:\/|$)/u;

@Injectable()
export class ServeDefault extends WebServe {
  private readonly appEnv = inject(AppEnv);

  private readonly vite = inject(ViteHandoff);

  private readonly federation = inject(Federation);

  private readonly logger = inject(Logger);

  /** 页面响应的前置认证（host 的 `connection.authorizeIndex`，负责下发浏览器 cookie）。 */
  private authorizeIndex: ((req: IncomingMessage, res: ServerResponse) => boolean) | undefined;

  /** 装配方可注入页面认证（可选）。 */
  withAuthorize(authorize: (req: IncomingMessage, res: ServerResponse) => boolean): this {
    this.authorizeIndex = authorize;
    return this;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 桌面形态的请求可能带完整 URL（自定义协议）：先归一成路径。
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(req.url ?? "")) {
      const absolute = new URL(req.url ?? "");
      req.url = `${absolute.pathname}${absolute.search}`;
    }
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path.startsWith("/.well-known/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (REPO_PATH.test(path)) {
      this.logger.warn(`[serve] reject repo path ${path} referer=${req.headers.referer ?? "-"}`);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("这是仓库里的路径（打包形态下不存在）\n");
      return;
    }
    // `node_modules` 里的路径**一律归联邦链**：vite 只该服务仓库源码，三方包走按包预编译的产物。
    // 请求形如 `/@fs/<abs>/node_modules/<pkg>/<subpath>`（pnpm 是 `.../node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`）。
    const federated = await this.redirectNodeModules(path, res);
    if (federated) return;
    if (path === "/" || path === "/index.html") {
      await this.replyPage(req, res);
      return;
    }
    if (this.vite.serve(req, res)) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("client-modules: vite 没有这条路由\n");
  }

  /** `/@fs/…/node_modules/<pkg>/…` → 302 到联邦地址（解析不到就交给 vite）。 */
  private async redirectNodeModules(path: string, res: ServerResponse): Promise<boolean> {
    if (!path.startsWith("/@fs/") || !path.includes("/node_modules/")) return false;
    const after = path.slice(path.lastIndexOf("/node_modules/") + "/node_modules/".length);
    const match = /^((?:@[^/]+\/)?[^/]+)\/(.+)$/u.exec(after);
    if (match === null) return false;
    const [, name, subpath] = match;
    if (name === undefined || subpath === undefined) return false;
    const url = await this.federation.depsUrl(`${name}/${subpath}`);
    if (url === undefined) return false;
    res.writeHead(302, { location: url, "cache-control": "no-store" });
    res.end();
    return true;
  }

  private async replyPage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.authorizeIndex !== undefined && !this.authorizeIndex(req, res)) return;
    const html = await readFile(join(this.appEnv.appBootDir, "index.html"), "utf8").catch(
      () => undefined,
    );
    if (html === undefined) {
      this.logger.warn(`[serve] 页面骨架读不到：${join(this.appEnv.appBootDir, "index.html")}`);
      res.writeHead(404);
      res.end();
      return;
    }
    // 入口脚本走 `/@fs/<绝对路径>`（vite 的 root 收在 app-boot，相对路径要靠 root 解析）。
    const entryUrl = `/@fs${join(this.appEnv.appBootDir, "index.ts")}`;
    let injected = html.replace(/(src=)"\.\/index\.ts"/, `$1"${entryUrl}"`);
    if (this.vite.hmr) {
      injected = injected.replace(
        "</head>",
        `  <script type="module" src="/@vite/client"></script>\n  </head>`,
      );
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : injected);
  }
}

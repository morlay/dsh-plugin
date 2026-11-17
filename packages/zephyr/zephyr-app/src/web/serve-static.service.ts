// 生产态的页面兜底：**只做静态投递**。
//
// 它是 dev 的 `ServeDefault`（在开发运行时那个包，要认 vite 的 URL 空间）在生产形态的对应物：
// 不认 `/@fs`、不认 `/@vite/client`、不认识联邦的按请求构建——那些全是开发态的事。
// 这里只做三件事：`/.well-known/` 空应答、页面骨架、其余交给 `ClientAssets`（静态目录）。
//
// 它注册在 `WebServer` 上（生产态没有开发运行时的那条路由装配）：
// prefix `/_zephyr/@modules` + fallback，其余路径一律 404。
import type { IncomingMessage, ServerResponse } from "node:http";
import { inject, Injectable, type Context, type OnDispose, type OnInit } from "@morlay/zephyr";
import { CLIENT_MODULES_PREFIX, ClientAssets } from "../client-assets/client-assets.contract.ts";
import { WebServer } from "./web-server.contract.ts";

/** 仓库路径（打包形态下不存在，放过去只会让人在几百条请求里猜）。 */
const REPO_PATH = /^\/(?:packages|vendor|apps|devpackages|node_modules)(?:\/|$)/u;

@Injectable()
export class ServeStatic implements OnInit, OnDispose {
  private readonly assets = inject(ClientAssets);

  private readonly webServer = inject(WebServer);

  private dispose: (() => Promise<void>) | undefined;

  /**
   * 接上宿主的两条路由。
   * @param _ctx - 本行上下文（未使用）。
   */
  onInit(_ctx: Context): void {
    const disposePrefix = this.webServer.register({
      kind: "prefix",
      path: CLIENT_MODULES_PREFIX,
      handler: (req, res) => this.reply(req, res),
    });
    const disposeFallback = this.webServer.registerFallback((req, res) => this.reply(req, res));
    this.dispose = async () => {
      disposeFallback();
      disposePrefix();
    };
  }

  /** 撤路由。 */
  onDispose(): Promise<void> {
    const dispose = this.dispose;
    this.dispose = undefined;
    return dispose?.() ?? Promise.resolve();
  }

  /**
   * 一个请求：页面 → 骨架；其余 → 静态目录；都没有就是 404。
   * @param req - 进来的请求。
   * @param res - 应答的对象。
   */
  async reply(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 桌面形态的请求可能带完整 URL（自定义协议）：先归一成路径。
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(req.url ?? "")) {
      req.url = new URL(req.url ?? "").pathname;
    }
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path.startsWith("/.well-known/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (REPO_PATH.test(path)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("这是仓库里的路径（打包形态下不存在）\n");
      return;
    }
    if (path === "/" || path === "/index.html") {
      await this.replyPage(req, res);
      return;
    }
    if (await this.assets.serve(req, res)) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("client_modules: 前端资产没有这条路由\n");
  }

  /**
   * 页面骨架：读静态目录里的 `index.html`（入口地址在构建期就写好了，运行期不再改写）。
   * @param req - 进来的请求。
   * @param res - 应答的对象。
   */
  private async replyPage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 走 `ClientAssets` 的同一套地址规则：`/` 就是静态目录里的 `index.html`。
    req.url = "/index.html";
    if (await this.assets.serve(req, res)) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("client_modules: 缺 index.html（先跑 zephyr build）\n");
  }
}

/**
 * dev 形态的客户端资源服务：**全权交给 vite**。
 *
 * 我们只提供两件它不知道的事：① 哪些包是 client 行、它们的源码入口在哪；② 页面 HTML 的骨架与自己那套
 * 入口（`/plugins/.app/entry.js`）。其余（依赖预打包、CJS→ESM、具名导出、外置 require、共享 chunk、
 * 内容 hash 缓存、HMR）都是 vite dev server 的现成能力——自己实现这些正是前面绕远路的地方。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { createServer, type ServerOptions, type ViteDevServer } from "vite";
import { clientModulesAlias } from "./bundle.ts";
import { dshClientRowsPlugin, ROWS_VIRTUAL } from "./vite-plugin.ts";
import { packageRootOf } from "./resolve.ts";

/**
 * 行清单来源：cordis Loader 的 entries 里声明 `dsh.client` 的那些包。
 *
 * 只给**包名**——包的位置与 client 半的入口交给 vite 自己 resolve（插件里用 `this.resolve`）。
 */
export interface RowsSource {
  /** 行清单：包名 → client 半的源文件（各 entry 用自己的 baseUrl 解析）。 */
  rows: () => Promise<Map<string, string>>;
}

function rowsOf(source: RowsSource): Promise<Map<string, string>> {
  return source.rows();
}

/** 起一个 vite dev server（middleware 模式），并把 `/plugins` 前缀下的请求交给它。 */
/** vite 的 HMR WebSocket 路径：专有路径，避免与上游自身的 upgrade 路由抢。 */
export const HMR_PATH = "/__dsh_hmr";

/** vite 期望的 http server 类型（`server.hmr.server`）：HMR 的 WebSocket 挂在它的 `upgrade` 上。 */
type HmrServer = NonNullable<Extract<NonNullable<ServerOptions["hmr"]>, { server?: unknown }>["server"]>;

export interface ViteHandoff {
  /** 有没有挂 HMR（无端口形态没有同源的 http server 可挂，见 `hmr: false`）——页面决定要不要注入客户端。 */
  hmr: boolean;
  /** 把 `/plugins/*` 的请求交给 vite（返回 true 表示它接管了）。 */
  serve: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** 让 vite 渲染一份 HTML（插件的 `transformIndexHtml` 会在这里注入入口 script）。 */
  transformHtml: (html: string) => Promise<string>;
}

export async function startViteDev(
  ctx: Context,
  options: {
    repoRoot: string;
    base: string;
    rows: RowsSource;
    resolvePluginUrl: (url: string) => Promise<string | undefined>;
    /** 裸说明符 → 联邦地址（三方与"非开发模块"都由它接管，见 `ClientRowsPluginOptions.depsUrl`）。 */
    depsUrl: (specifier: string) => Promise<string | undefined>;
    /** 宿主进程的 http server：HMR 的 WebSocket 要挂在它的 `upgrade` 上。 */
    httpServer?: HmrServer | undefined;
  },
): Promise<ViteHandoff> {
  const { repoRoot, base } = options;
  /** 页面与入口所在的真实目录（vite 的 root）。 */
  const appRoot = join(repoRoot, "packages", "client", "dsh-client-modules", "app-boot");
  /** 页面所在的端口（HMR 的 WebSocket 必须与页面**同源同端口**，否则客户端连不上）。 */
  const pagePort = ((): number | undefined => {
    const address = options.httpServer?.address();
    if (address !== null && address !== undefined && typeof address === "object") return address.port;
    const fromEnv = process.env["PORT"];
    return fromEnv === undefined ? undefined : Number(fromEnv);
  })();
  // **当前**实例：vite 自己 `restart()` 后会建一个新 server，插件的 `configureServer` 再回调过来。
  // 不跟这个引用的话，重启之后路由还指着已关闭的旧实例（请求开始成片失败，宿主也可能因此退出）。
  let current: ViteDevServer | undefined;
  const server: ViteDevServer = await createServer({
    // **root 收在 app-boot**：仓库里的源码都在 root 之外，vite 因此只能用 `/@fs/<绝对路径>` 引用它们
    // ——URL 空间只剩 `@` 前缀（`@/…`、`@client-modules/…`、`/@fs/…`、`/@id/…`、`/@vite/…`），不会有
    // 裸的 `/packages/…`、`/vendor/…` 混进来。页面与入口就是这个目录里的两个文件。
    root: appRoot,
    // 先让 vite 用**它自己的 URL 空间**（`/@vite`、`/@id`、`/@fs` 都在根上）；对外那层 `/plugins/...`
    // 等页面跑起来再作为映射加回来。
    //
    // **不要**把 base 改成 `/@/` 去"统一前缀"：vite 会给所有不以 base 开头的绝对 URL 再补一层，
    // 联邦地址（`/@client-modules/…`）会变成 `/@/@client-modules/…`，两条链全断。
    base: "/",
    // 浏览器没有 `process`：客户端半常读 `process.env.NODE_ENV`（上游 client 打包也做同样的替换）。
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "development"),
      "process.env": "{ env: {} }",
      // 裸 `process` 同样要给空壳（逐文件服务的源码里也会读它）。
      process: "{ env: {} }",
    },
    publicDir: false,
    appType: "spa",
    // 依赖优化：**非开发模块**（`dsh.dev.exclude`）的入口交给 vite 预打包——一次构建、共享 chunk、
    // 落盘 `<root>/node_modules/.vite/deps`、按内容 hash 失效；改着的包不在其中，仍逐文件走 vite（HMR）。
    // 缓存目录用默认的 `node_modules/.vite`：跨进程、跨 profile 共用一份，不按进程隔离。
    //
    // **不用 vite 的 optimizeDeps**：客户端资源由我们自己的联邦链产出（`@client-modules/…`），vite 只管
    // 页面与本地文件（`@/…`）。开着它会去预打包 workspace 源码，形成第二条链（浏览器里出现
    // `node_modules/.vite/deps/@_packages_profile…` 就是这么来的）。
    // **不读也不监听配置文件**：配置全是内联的（下面这些字段）。默认它会在 root 下找 `vite.config.*`
    // 并 watch，改动就 `restart()` 自己——而这个 dev server 跑在 dsh 宿主进程里，重启会连带把整条
    // 服务拖下水。关掉这条路径。
    configFile: false,
    resolve: {
      // `@/…` → 仓库根、`node:*` → 求值安全的空替身（与联邦构建同一套约定，替身形态见 `node-stub.*`）。
      alias: clientModulesAlias({ repoRoot, nodeStub: join(appRoot, "node-stub.ts") }),
    },
    server: {
      middlewareMode: true,
      // **关掉预转换**：vite 会对模块的静态 import 递归预热（`transformRequest`），而我们的联邦地址是
      // **外部** URL（由自己的路由按请求预编译）——它照样去 load，于是日志里一串
      // `Pre-transform error: Failed to load url /@client-modules/…`。预热换来的并行度不值得这份噪音。
      preTransformRequests: false,
      // HMR 的 WebSocket 挂到宿主的 http server 上：**路径专有**（避免与上游自身的 upgrade 路由抢），
      // **端口与页面一致**（客户端连的就是页面这个端口）。调用方要先在 webServer 上注册同名 upgrade
      // 路由——上游对未注册的升级请求会直接 destroy socket，vite 就握不上手。
      ...(options.httpServer === undefined
        ? // 无端口形态（桌面）：没有同源的 http server 可以挂 HMR 的 WebSocket，vite 自开的端口只会
          // 在同一个开发机上互相抢（`Port 24678 is already in use`）。桌面形态先不挂 HMR。
          { hmr: false }
        : {
            hmr: {
              server: options.httpServer,
              path: HMR_PATH,
              ...(pagePort === undefined ? {} : { clientPort: pagePort }),
            },
          }),
      // 整个仓库都在 root 内，`/@fs/…` 的许可自然覆盖（vite 对 root 之外的文件会**放行**到 next，
      // 表现为一串"没被 vite 接手"的 404）。
      fs: { strict: false, allow: [repoRoot] },
    },
    // **不用** vite 的 `optimizeDeps`：裸说明符已由插件统一改写成 `@deps/`（我们自己预打包的产物），
    // vite 再打一份就会与聚合产物里的那份形成两个实例。
    // **不用** vite 的 `optimizeDeps`（关掉自动发现）：非开发模块与三方都由我们的联邦链产出，裸说明符
    // 已在插件里改写成 `@client-modules/…`，这里没有任何东西需要预打包。开着只会多出第二条链（浏览器里
    // 同时出现 `.vite/deps/react.js` 与我们的 `@client-modules/react@…/index.js`）与一次全仓扫描。
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      dshClientRowsPlugin({
        repoRoot,
        rows: () => rowsOf(options.rows),
        resolvePluginUrl: options.resolvePluginUrl,
        depsUrl: options.depsUrl,
        onServer: (devServer) => {
          current = devServer;
        },
      }),
    ],
  });
  current = server;
  ctx.logger.info("client-modules: vite dev server 就绪（root=%s）", repoRoot);
  /** 页面入口（root=app-boot，所以就是 `/index.html`）。 */
  const pageEntry = "/index.html";
  const serve = (req: IncomingMessage, res: ServerResponse): boolean => {
    if ((req.url ?? "").split("?")[0] === "/" || (req.url ?? "").split("?")[0] === "/index.html") {
      req.url = pageEntry;
    }
    // `/plugins/*` 由 host 那层自己的路由先处理（那里挂的是对外形态的资源），其余全交给 vite——
    // 它要服务的形态很多（虚拟模块 `/@id`、取文件 `/@fs`、预打包 `/node_modules/.vite/deps`、HMR
    // 通道），白名单只会不断漏。
    if ((req.url ?? "").startsWith(`${base}/`)) return false;
    // 单次请求出错不该把宿主带走：vite 的 middlewares 里任何未捕获异常都只记一条 500。
    try {
      // 非 2xx 才留痕（正常请求不吵）：vite 没接住时能立刻看到是哪条 URL。
      res.on("finish", () => {
        if (res.statusCode < 400) return;
        process.stderr.write(`[vite] ${req.method ?? ""} ${req.url ?? ""} → ${String(res.statusCode)}\n`);
      });
      ;(current ?? server).middlewares(req, res, () => {
        // vite 没接住：留下线索（桌面形态经自定义协议进来，请求形态与 http 不同，这条日志能立刻定位）。
        process.stderr.write(`[vite] miss ${req.method ?? ""} ${req.url ?? ""}\n`);
        if (!res.headersSent) res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        if (!res.writableEnded) res.end("client-modules: vite 没有这条路由\n");
      });
    } catch (error) {
      ctx.logger.error(error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      if (!res.writableEnded) res.end(`dev-client: vite 处理失败：${String(error)}\n`);
    }
    return true;
  };
  return {
    serve,
    transformHtml: async (html: string) => await server.transformIndexHtml(`${base}/`, html),
    hmr: options.httpServer !== undefined,
  };
}

/** 虚拟入口的浏览器 URL（HTML 里引用它）。 */
export const ROWS_URL = `@id/__x00__${ROWS_VIRTUAL}`;

/** 包根解析用（`packageRootOf` 在这里只用一次，便于将来换成 vite 的 resolver）。 */
export { packageRootOf };

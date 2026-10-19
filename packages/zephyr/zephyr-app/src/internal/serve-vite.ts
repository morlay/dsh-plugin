/**
 * dev 形态的客户端资源服务：**全权交给 vite**。
 *
 * 我们只提供两件它不知道的事：① 哪些包是 client 行、它们的源码入口在哪；② 页面 HTML 的骨架与自己那套
 * 入口（`/plugins/.app/entry.js`）。其余（依赖预打包、CJS→ESM、具名导出、外置 require、共享 chunk、
 * 内容 hash 缓存、HMR）都是 vite dev server 的现成能力——自己实现这些正是前面绕远路的地方。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { traceOf } from "./trace.ts";
import { createServer, type ServerOptions, type ViteDevServer } from "vite";
import { clientModulesAlias } from "../federation/bundle.ts";
import { dshClientRowsPlugin, ROWS_VIRTUAL } from "./vite-plugin.ts";
import { packageRootOf } from "./resolve.ts";
import { addZephyrPrefix, attachUrlRewriting, stripZephyrPrefix } from "./hmr-path.ts";
import { HMR_PATH } from "./hmr-path.ts";

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

/** vite 期望的 http server 类型（`server.hmr.server`）：HMR 的 WebSocket 挂在它的 `upgrade` 上。 */
type HmrServer = NonNullable<
  Extract<NonNullable<ServerOptions["hmr"]>, { server?: unknown }>["server"]
>;

export interface ViteHandoff {
  /** 有没有挂 HMR（无端口形态没有同源的 http server 可挂，见 `hmr: false`）——页面决定要不要注入客户端。 */
  hmr: boolean;
  /** 把 `/plugins/*` 的请求交给 vite（返回 true 表示它接管了）。 */
  serve: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** 让 vite 渲染一份 HTML（插件的 `transformIndexHtml` 会在这里注入入口 script）。 */
  transformHtml: (html: string) => Promise<string>;
}

/**
 * vite 8 的 HMR WebSocket 运行时是 `ws` 包的 `Server`：类型层只导出了 HMR 通道面
 * （`on`/`off`/`send`），没有 `handleUpgrade`/`emit('connection')` 这两个 `ws` 的成员。
 * `server.ws` 的运行时值就是它，所以这里按 `ws` 的最小面断言一次。
 */
/** 一次 HMR 握手：交给 vite 的 ws 服务完成升级，再按 `ws` 的约定把新连接接回它的 connection 事件。 */
export async function startViteDev(
  ctx: Context,
  options: {
    repoRoot: string;
    /** 页面与入口所在目录（`AppEnv.appBootDir`：应用自己的 `src/client`）。 */
    appRoot: string;
    base: string;
    /** 页面响应的前置认证（host 的 `connection.authorizeIndex`，负责下发浏览器 cookie）。 */
    authorizeIndex?: (req: IncomingMessage, res: ServerResponse) => boolean;
    rows: RowsSource;
    /** 聚合名单（glob）：命中的包走按包联邦产物，不逐文件走 vite。 */
    aggregate?: readonly string[];
    /** 裸说明符 → 联邦地址（三方与"非开发模块"都由它接管，见 `ClientRowsPluginOptions.depsUrl`）。 */
    depsUrl: (specifier: string, importer?: string) => Promise<string | undefined>;
    /** 宿主进程的 http server：HMR 的 WebSocket 要挂在它的 `upgrade` 上。 */
    httpServer?: HmrServer | undefined;
    /** 页面所在的端口（配置值）：`address()` 在 listen 完成前是 null，不能靠它推。 */
    pagePort?: number | undefined;
  },
): Promise<ViteHandoff> {
  const trace = traceOf(ctx, "vite");
  const { repoRoot, base } = options;
  /**
   * 页面与入口所在的真实目录（vite 的 root）。
   *
   * 按**本包自己的位置**推，不从 `repoRoot` 拼：打包形态下 `repoRoot` 是 profile 目录
   * （数据根下的装配目录），从它拼出的 `packages/client/…/app-boot` 并不存在——vite 的 root
   * 一空，`/index.html` 404、入口也转译不了，页面就只剩一具空壳。这条事实与 `index.ts` 的 `appRoot`
   * 同源（那里也从包根推）。
   */
  // vite 的 root = **应用**的 client 目录（入口归应用）；由装配面经 `AppEnv.appBootDir` 传进来。
  const appRoot = options.appRoot;
  /** 页面所在的端口（HMR 的 WebSocket 必须与页面**同源同端口**，否则客户端连不上）。 */
  const pagePort = ((): number | undefined => {
    if (options.pagePort !== undefined) return options.pagePort;
    const address = options.httpServer?.address();
    if (
      address !== null &&
      address !== undefined &&
      typeof address === "object"
    )
      return address.port;
    // 不读运行期环境变量：端口只有两个显式来源（`pagePort` 或已 listen 的 http server）。
    return undefined;
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
    // 联邦地址（`/_zephyr/@modules/…`）会变成 `/@/_zephyr/@modules/…`，两条链全断。
    base: "/",
    // 浏览器没有 `process`：客户端半常读 `process.env.NODE_ENV`（上游 client 打包也做同样的替换）。
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        process.env["NODE_ENV"] ?? "development",
      ),
      "process.env": "{ env: {} }",
      // 裸 `process` 同样要给空壳（逐文件服务的源码里也会读它）。
      process: "{ env: {} }",
      // vite 8 的客户端脚本（`/@vite/client`）读这两个注入的全局；不给自己 define 就会
      // `ReferenceError: __DEFINES__ is not defined`。
      __DEFINES__: "{}",
    },
    publicDir: false,
    // **不做 history fallback**（`spa` 会把没解析出来的路径静默回一份 index.html）：请求都在 `@` 前缀
    // 的 URL 空间里（`@/…`、`@client-modules/…`、`/@fs/…`），谁没解析出来就该**当场 404**——否则浏览器
    // 把 HTML 当模块执行，报出来的是一堆看不懂的错，而真正没命中的那个 URL 连线索都没有。
    appType: "mpa",
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
    // 装饰器：装配面（`@Module` / `@Injectable`）是 **legacy** 装饰器；vite 8 的转译走 oxc，
    // `decorator.legacy` 打开它（默认不转，语法会原样留在浏览器里 → `Unexpected token 'export'`）。
    oxc: {
      target: "esnext",
      decorator: { legacy: true },
    },
    // 服务的工作目录（vite 的 `cacheDir`/`fs.allow` 都以它与本 root 为基准）：显式传，别让它取进程 cwd
    // ——宿主可能从任意目录起。
    cacheDir: join(repoRoot, "node_modules", ".vite"),
    resolve: {
      // `@/…` → 仓库根、`node:*` → 求值安全的空替身（与联邦构建同一套约定，替身形态见 `src/node-stub/`）。
      alias: clientModulesAlias({
        repoRoot,
        nodeStub: join(dirname(appRoot), "..", "node-stub", "index.ts"),
      }),
    },
    server: {
      middlewareMode: true,
      // **关掉预转换**：vite 会对模块的静态 import 递归预热（`transformRequest`），而我们的联邦地址是
      // **外部** URL（由自己的路由按请求预编译）——它照样去 load，于是日志里一串
      // `Pre-transform error: Failed to load url /_zephyr/@modules/…`。预热换来的并行度不值得这份噪音。
      preTransformRequests: false,
      // HMR 的 WebSocket：**路径专有**（避免与上游自身的 upgrade 路由抢），**端口与页面一致**（客户端连的
      // 就是页面这个端口）。**把 `server` 交给 vite**：它的 `createWebSocketServer` 会在宿主 server 上挂
      // `upgrade` 监听，自己做 `sec-websocket-protocol: vite-hmr` 与 path 的匹配（`shouldHandle`）。
      // 我们**不再**自己接 `/_zephyr/hmr` 的 upgrade：`server.ws` 是 `NormalizedHotChannel`，没有 `handleUpgrade`
      // （真正的 `wss` 是 vite 内部的 `noServer` 实例），自己转一次只会把 socket 断掉。
      ...(options.httpServer === undefined
        ? {}
        : {
            hmr: {
              server: options.httpServer,
              path: HMR_PATH,
              ...(pagePort === undefined ? {} : { clientPort: pagePort }),
            },
          }),
      // 仓库源码都在 root（app-boot）之外：`/@fs/<绝对路径>` 要能读到，allow 里放仓库根。
      fs: { strict: false, allow: [repoRoot, appRoot] },
    },
    // **不用** vite 的 `optimizeDeps`：裸说明符已由插件统一改写成 `@deps/`（我们自己预打包的产物），
    // vite 再打一份就会与聚合产物里的那份形成两个实例。
    // **不用** vite 的 `optimizeDeps`（关掉自动发现）：非开发模块与三方都由我们的联邦链产出，裸说明符
    // 已在插件里改写成 `@client-modules/…`，这里没有任何东西需要预打包。开着只会多出第二条链（浏览器里
    // 同时出现 `.vite/deps/react.js` 与我们的 `@client-modules/react@…/index.js`）与一次全仓扫描。
    // **彻底不用** vite 的依赖优化器：裸说明符已由插件统一改写成 `@client-modules/…`（我们自己的联邦链产出），
    // 这里没有任何东西需要它预打包。`noDiscovery: true` 只关了"自动发现"，扫描器仍会去解析那些包名——而行清单
    // 是**虚拟模块**、里面写的包名 vite 按 `package.json` 的去向解析，落到工作区解析面上就报
    // `Cannot find package … imported from …/package.json`（上游 workspace 内部包只存在于 vendor / 闭包）。
    // `disabled` 是官方给的"整个关掉"（标了 deprecated，但语义正是这个）。
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      dshClientRowsPlugin({
        aggregate: options.aggregate ?? [],
        repoRoot,
        rows: () => rowsOf(options.rows),
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
    // 对外统一 `/_zephyr/@…`，交给 vite 之前 strip 回它自己的 URL 空间。
    if (req.url !== undefined) req.url = stripZephyrPrefix(req.url);
    if (
      (req.url ?? "").split("?")[0] === "/" ||
      (req.url ?? "").split("?")[0] === "/index.html"
    ) {
      // 页面由 vite 出（不是上游 `frontend-static`）：浏览器的认证 cookie 得在这里下发——
      // 少了它，client 的 `/api/remote.mux` WebSocket 会被 `admitConnection` 拒掉（表现为无限重连）。
      if (
        options.authorizeIndex !== undefined &&
        !options.authorizeIndex(req, res)
      )
        return true;
      req.url = pageEntry;
    }
    // 到这里说明 host 那边的路由（`/plugins/*` 等）已经先处理过了：**其余全交给 vite**——
    // 它要服务的形态很多（虚拟模块 `/@id`、取文件 `/@fs`、预打包 `/node_modules/.vite/deps`、HMR 通道），
    // 白名单只会不断漏。
    // 单次请求出错不该把宿主带走：vite 的 middlewares 里任何未捕获异常都只记一条 500。
    try {
      // 访问日志的 home 是 `WebServer`（每个请求一行），这层不再自己打。
      // 出站 body 的 URL 前缀重写（gzip 包装之内：我们写明文，压缩由外层负责）。
      attachUrlRewriting(res);
      (current ?? server).middlewares(req, res, () => {
        // vite 没接住：留下线索（桌面形态经自定义协议进来，请求形态与 http 不同，这条日志能立刻定位）。
        trace("miss %s %s", req.method ?? "", req.url ?? "");
        if (!res.headersSent)
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        if (!res.writableEnded) res.end("client-modules: vite 没有这条路由\n");
      });
    } catch (error) {
      ctx.logger.error(error);
      if (!res.headersSent)
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      if (!res.writableEnded)
        res.end(`dev-client: vite 处理失败：${String(error)}\n`);
    }
    return true;
  };
  return {
    serve,
    transformHtml: async (html: string) =>
      addZephyrPrefix(await server.transformIndexHtml(`${base}/`, html)),
    hmr: options.httpServer !== undefined,
  };
}

/** 虚拟入口的浏览器 URL（HTML 里引用它）。 */
export const ROWS_URL = `@id/__x00__${ROWS_VIRTUAL}`;

/** 包根解析用（`packageRootOf` 在这里只用一次，便于将来换成 vite 的 resolver）。 */
export { packageRootOf };


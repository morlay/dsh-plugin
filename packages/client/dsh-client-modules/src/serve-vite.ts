/**
 * dev 形态的客户端资源服务：**全权交给 vite**。
 *
 * 我们只提供两件它不知道的事：① 哪些包是 client 行、它们的源码入口在哪；② 页面 HTML 的骨架与自己那套
 * 入口（`/plugins/.app/entry.js`）。其余（依赖预打包、CJS→ESM、具名导出、外置 require、共享 chunk、
 * 内容 hash 缓存、HMR）都是 vite dev server 的现成能力——自己实现这些正是前面绕远路的地方。
 */
import { clientAssetPlugin, cssInlinePlugins } from "@local/tsdown-plugin-cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { createServer, type ServerOptions, type ViteDevServer } from "vite";
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
    /** 非开发模块的包名：交给 vite 的 `optimizeDeps` 预打包（`include` 用裸名，alias 指到源码）。 */
    optimizeInclude: readonly string[];
    /** 这些包名 → 各自的 client 半源码（给 `resolve.alias`，让裸名可解析）。 */
    optimizeAlias: readonly { name: string; entry: string }[];
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
    // **root 是整个仓库**：这样 vite 能服务仓库里任何源文件（`/@fs/…` 与依赖解析都要它）；页面与入口
    // 仍是 `app-boot/index.html` 与 `app-boot/index.ts`，由下面那条重写把 `/` 指过去。
    root: repoRoot,
    // 先让 vite 用**它自己的 URL 空间**（`/@vite`、`/@id`、`/@fs` 都在根上）；对外那层 `/plugins/...`
    // 等页面跑起来再作为映射加回来。
    base: "/",
    // 浏览器没有 `process`：客户端半常读 `process.env.NODE_ENV`（上游 client 打包也做同样的替换）。
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "development"),
      "process.env": "{ env: {} }",
    },
    publicDir: false,
    appType: "spa",
    // 依赖优化：**非开发模块**（`dsh.dev.exclude`）的入口交给 vite 预打包——一次构建、共享 chunk、
    // 落盘 `<root>/node_modules/.vite/deps`、按内容 hash 失效；改着的包不在其中，仍逐文件走 vite（HMR）。
    // 缓存目录用默认的 `node_modules/.vite`：跨进程、跨 profile 共用一份，不按进程隔离。
    //
    // 这些入口是**我们的源码**（里面有 `?raw`、CSS Modules 这类只有 vite 转换链认得的东西），优化器自己
    // 不认识——所以把它俩用的插件也挂给它：预打包与 dev 转换因此是同一套规则，我们没另造机制。
    //
    // `include` 里写的是**包名**（裸说明符）：optimizer 只认这个形态，再靠下面 `resolve.alias` 把
    // 这些名字指到各自的 client 半，于是"预打包"与"引用"是同一个身份。
    optimizeDeps: {
      include: [...options.optimizeInclude],
      rolldownOptions: {
        plugins: [cssInlinePlugins({ name: "dsh-deps", assets: "inline" }), clientAssetPlugin()],
      },
    },
    // **不读也不监听配置文件**：配置全是内联的（下面这些字段）。默认它会在 root 下找 `vite.config.*`
    // 并 watch，改动就 `restart()` 自己——而这个 dev server 跑在 dsh 宿主进程里，重启会连带把整条
    // 服务拖下水。关掉这条路径。
    configFile: false,
    resolve: {
      // `node:*` 一律指向求值安全的空替身：宿主半的代码偶尔被同包的相对导入拖进 client 图，vite 默认的
      // browser-external 代理在读取成员时抛错，会让整条入口求值中断（页面白屏 + 一条难归因的报错）。
      alias: [
        // `@/…` → 仓库根：HTML 与源码里引用仓库内文件都用这个前缀，不写死绝对路径、也不依赖相对谁。
        { find: /^@\//, replacement: `${repoRoot}/` },
        // `node:*` 一律指向求值安全的空替身：宿主半的代码偶尔被同包的相对导入拖进 client 图，vite 默认的
        // browser-external 代理在读取成员时抛错，会让整条入口求值中断（页面白屏 + 一条难归因的报错）。
        { find: /^node:/, replacement: join(appRoot, "node-stub.ts") },
        // **非开发模块**的包名 → 各自的 client 半源码：这样`optimizeDeps.include` 里的裸名能被
        // optimizer 解析到，预打包与引用是同一个身份（改着的包不进这里，仍走 vite 的模块图）。
        ...options.optimizeAlias.map(({ name, entry }) => ({
          find: new RegExp(`^${name.replace(/[/\\^$*+?.()|[\]{}]/gu, "\\$&")}$`),
          replacement: entry,
        })),
      ],
    },
    server: {
      middlewareMode: true,
      // HMR 的 WebSocket 挂到宿主的 http server 上：**路径专有**（避免与上游自身的 upgrade 路由抢），
      // **端口与页面一致**（客户端连的就是页面这个端口）。调用方要先在 webServer 上注册同名 upgrade
      // 路由——上游对未注册的升级请求会直接 destroy socket，vite 就握不上手。
      ...(options.httpServer === undefined
        ? {}
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
    plugins: [
      dshClientRowsPlugin({
        repoRoot,
        rows: () => rowsOf(options.rows),
        resolvePluginUrl: options.resolvePluginUrl,
        onServer: (devServer) => {
          current = devServer;
        },
      }),
    ],
  });
  current = server;
  ctx.logger.info("client-modules: vite dev server 就绪（root=%s）", repoRoot);
  /** 页面入口（相对 root 的路径）：`/` 重写到这里，HTML 里的 `./index.ts` 也随之解析到 app-boot 下。 */
  const pageEntry = "/packages/client/dsh-client-modules/app-boot/index.html";
  const serve = (req: IncomingMessage, res: ServerResponse): boolean => {
    // `@/…` = **当前 workspace 的文件**（与源码里 import 的 alias 同一套写法）。浏览器 URL 不走 alias
    // 解析，所以在这里把它落成 root 相对的路径——`/@/packages/client/x/src/a.ts` → `/packages/client/x/src/a.ts`。
    const url = req.url ?? "";
    if (url.startsWith("/@/")) {
      req.url = url.slice("/@".length);
    }
    if ((req.url ?? "").split("?")[0] === "/" || (req.url ?? "").split("?")[0] === "/index.html") {
      req.url = pageEntry;
    }
    // `/plugins/*` 由 host 那层自己的路由先处理（那里挂的是对外形态的资源），其余全交给 vite——
    // 它要服务的形态很多（虚拟模块 `/@id`、取文件 `/@fs`、预打包 `/node_modules/.vite/deps`、HMR
    // 通道），白名单只会不断漏。
    if ((req.url ?? "").startsWith(`${base}/`)) return false;
    // 单次请求出错不该把宿主带走：vite 的 middlewares 里任何未捕获异常都只记一条 500。
    try {
      ;(current ?? server).middlewares(req, res, () => {
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
  };
}

/** 虚拟入口的浏览器 URL（HTML 里引用它）。 */
export const ROWS_URL = `@id/__x00__${ROWS_VIRTUAL}`;

/** 包根解析用（`packageRootOf` 在这里只用一次，便于将来换成 vite 的 resolver）。 */
export { packageRootOf };

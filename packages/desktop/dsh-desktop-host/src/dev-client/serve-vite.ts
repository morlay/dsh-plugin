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
import { dshClientRowsPlugin, ROWS_VIRTUAL } from "./vite-plugin.ts";
import { packageRootOf } from "./modules.ts";

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
    /** 宿主进程的 http server：HMR 的 WebSocket 要挂在它的 `upgrade` 上。 */
    httpServer?: HmrServer | undefined;
  },
): Promise<ViteHandoff> {
  const { repoRoot, base } = options;
  /** 页面与入口所在的真实目录（vite 的 root）。 */
  const appRoot = join(repoRoot, "packages", "desktop", "dsh-desktop-host", "app-boot");
  /** 页面所在的端口（HMR 的 WebSocket 必须与页面**同源同端口**，否则客户端连不上）。 */
  const pagePort = ((): number | undefined => {
    const address = options.httpServer?.address();
    if (address !== null && address !== undefined && typeof address === "object") return address.port;
    const fromEnv = process.env["PORT"];
    return fromEnv === undefined ? undefined : Number(fromEnv);
  })();
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
    resolve: {
      // `node:*` 一律指向求值安全的空替身：宿主半的代码偶尔被同包的相对导入拖进 client 图，vite 默认的
      // browser-external 代理在读取成员时抛错，会让整条入口求值中断（页面白屏 + 一条难归因的报错）。
      alias: [
        // `@/…` → 仓库根：HTML 与源码里引用仓库内文件都用这个前缀，不写死绝对路径、也不依赖相对谁。
        { find: /^@\//, replacement: `${repoRoot}/` },
        // `node:*` 一律指向求值安全的空替身：宿主半的代码偶尔被同包的相对导入拖进 client 图，vite 默认的
        // browser-external 代理在读取成员时抛错，会让整条入口求值中断（页面白屏 + 一条难归因的报错）。
        { find: /^node:/, replacement: join(appRoot, "node-stub.ts") },
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
    optimizeDeps: {
      // 三方依赖（CJS 居多）由 vite 预打包：具名导出、外置 require、共享 chunk 都在这一步解决。
      // vite 8 起优化器就是 rolldown，`esbuildOptions` 已弃用（它自己在启动时警告），用 rolldownOptions。
      include: ["react", "react-dom", "react-dom/client", "scheduler"],
      rolldownOptions: {
        platform: "browser",
        transform: { define: { "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "development") } },
        // 预打包产物要供多处按需取用，导出一律保留（摇掉会让消费方的具名 import 落空）。
        treeshake: false,
      },
    },
    plugins: [
      dshClientRowsPlugin({
        repoRoot,
        rows: () => rowsOf(options.rows),
        resolvePluginUrl: options.resolvePluginUrl,
      }),
    ],
  });
  ctx.logger.info("dev-client: vite dev server 就绪（root=%s）", repoRoot);
  /** 页面入口（相对 root 的路径）：`/` 重写到这里，HTML 里的 `./index.ts` 也随之解析到 app-boot 下。 */
  const pageEntry = "/packages/desktop/dsh-desktop-host/app-boot/index.html";
  const serve = (req: IncomingMessage, res: ServerResponse): boolean => {
    if ((req.url ?? "").split("?")[0] === "/" || (req.url ?? "").split("?")[0] === "/index.html") {
      req.url = pageEntry;
    }
    // `/plugins/*` 由 host 那层自己的路由先处理（那里挂的是对外形态的资源），其余全交给 vite——
    // 它要服务的形态很多（虚拟模块 `/@id`、取文件 `/@fs`、预打包 `/node_modules/.vite/deps`、HMR
    // 通道），白名单只会不断漏。
    if ((req.url ?? "").startsWith(`${base}/`)) return false;
    server.middlewares(req, res, () => {
      if (!res.headersSent) res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      if (!res.writableEnded) res.end("dev-client: vite 没有这条路由\n");
    });
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

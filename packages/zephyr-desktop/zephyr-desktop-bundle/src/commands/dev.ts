// `zephyr desktop dev`：在 Electron 壳里跑开发形态。
//
// 壳是**独立进程**（Electron 的主进程），CLI 只负责把「工作区在哪、数据目录在哪、壳在哪、
// 宿主入口是哪个源码文件、页面在哪个端口」传过去，然后把退出码透传回来。
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inject, Injectable, Logger } from "@morlay/zephyr";
import {
  CliError,
  CliMode,
  Command,
  type CommandInput,
  type ParamSpecs,
  Workspace,
} from "@morlay/zephyr-cli";
import { appDataHomeOf, appRootOf, userDataDirOf } from "../desktop-dirs.ts";
import { stickyPort } from "../page-port.ts";

/** `zephyr desktop dev`。 */
@Injectable({ multi: true })
export class DesktopDevCommand extends Command {
  readonly path = ["desktop", "dev"];

  readonly description = "在 Electron 壳里跑工作区（开发形态：宿主在壳内，页面走 dev server）";

  readonly params: ParamSpecs = {};

  private readonly mode = inject(CliMode);

  private readonly resolved = inject(Workspace);

  private readonly logger = inject(Logger);

  /**
   * @returns 壳进程的退出码。
   */
  async run(_input: CommandInput): Promise<number> {
    const electron = resolveElectron();
    const shellMain = resolveShellMain();
    // 部署值先备好：userData 不在产物根里，端口偏好也记在它下面。
    const userData = await this.ensureUserData();
    // 页面与资源走 **dev server**（vite）：壳只当浏览器。壳内跑宿主那条路（单进程、无 vite）
    // 在第三方 CJS 包（zustand / immer）上会大面积 404——那是打包形态才需要验证的事。
    // 端口**粘住**上次用过的那个：origin 就是页面存储的身份，换了等于换一个浏览器；
    // 被别的进程占着才重探（`--port` 显式给的优先，且不写回）。
    const port = this.mode.port ?? (await stickyPort(userData));
    this.logger.info(
      "[desktop dev] 页面端口：%s（%s）",
      String(port),
      this.mode.port === undefined ? "粘住的端口，origin 因此稳定" : "--port 指定",
    );
    const server = this.startDevServer(port);
    /**
     * 收尾：先收壳、再收 dev server，最后**自己退出**。
     *
     * 早先只在 SIGINT 里杀 server、然后继续 `await` 壳退出——Ctrl+C 之后 CLI 就挂在那里不动了
     * （壳不响应 SIGINT、server 已经没了，谁也不会叫醒它）。
     * @param code - 退出码（SIGINT 128+2，SIGTERM 128+15）。
     */
    const shutdown = (code: number): void => {
      if (!server.killed && server.exitCode === null) server.kill("SIGTERM");
      setImmediate(() => process.exit(code));
    };
    process.once("SIGINT", () => shutdown(130));
    process.once("SIGTERM", () => shutdown(143));
    await this.waitForServer(port);
    this.logger.info("[desktop dev] 起壳：%s", shellMain);
    // Electron 会继承父进程的环境，其中两个必须摘掉（否则壳根本起不来）：
    // · `ELECTRON_RUN_AS_NODE=1`：让它以 Node 身份跑（没有 `protocol`、没有窗口）；
    // · `NODE_OPTIONS`：pnpm 的 `nodeOptions`（`--import @oxc-node/core/register`）会被 Electron 主进程继承，
    //   而那个注册器初始化要 `new Worker()`——Electron 的 V8 平台不支持，直接
    //   `Failed to construct 'Worker'` 崩在启动前。壳不需要 TS loader（它只当浏览器）。
    // Electron 会继承父进程的环境：
    // · `ELECTRON_RUN_AS_NODE=1` 必须摘掉（否则以 Node 身份跑，没有窗口）；
    // · `NODE_OPTIONS` **不是摘掉，是换成我们自己的 loader**——壳里要照旧能 `import` 到 `.ts`
    //   （宿主源码面、cordis 的参数属性都靠它转译）。pnpm 那份是 `@oxc-node/core/register`，它初始化
    //   要 `new Worker()`，Electron 的 V8 平台不支持，所以必须换成本仓库的 `@morlay/dsh-oxc-node`
    //   （同步 hooks，不建 Worker）。
    const {
      ELECTRON_RUN_AS_NODE: _runAsNode,
      NODE_OPTIONS: _pnpmNodeOptions,
      ...inherited
    } = process.env;
    const loader = resolveLoader();
    const child = spawn(electron, [shellMain], {
      stdio: "inherit",
      env: {
        ...inherited,
        ZEPHYR_DESKTOP_MODE: "dev",
        // dev 形态常跑在受限环境（容器 / CI / 无 GPU）里：不给这两个开关，Electron 的 GPU 与沙箱
        // 进程会 FATAL 退出（症状是窗口不出、日志里一串 "Failed to initialize sandbox"）。
        ZEPHYR_DESKTOP_NO_SANDBOX: "1",
        // 调试面默认开（DevTools + 渲染进程日志）；要安静就 `ZEPHYR_DESKTOP_DEBUG=0`。
        ZEPHYR_DESKTOP_DEBUG: process.env.ZEPHYR_DESKTOP_DEBUG ?? "1",
        // 与 dev server 子进程同一条约定：Node 侧的 TS 加载走本仓库的 loader。
        ...(loader === undefined ? {} : { NODE_OPTIONS: `--import ${loader}` }),
        ZEPHYR_DESKTOP_USER_DATA: userData,
        ZEPHYR_DESKTOP_WORKSPACE: this.mode.workspace,
        ZEPHYR_DESKTOP_DATA_DIR: this.mode.dataDir,
        // 宿主入口：dev 形态是工作区的服务端入口（源码面），由 loader 转译。
        // 必须用**同一个** `port` 变量（dev server 拿到的 `PORT` 也是它）；写 `mode.port ?? 3080`
        // 会在随机端口下把壳指向 3080，表现为 `ERR_CONNECTION_REFUSED`。
        ZEPHYR_DESKTOP_URL: `http://127.0.0.1:${String(port)}/`,
      },
    });
    return new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        // 壳退了（用户关窗），server 跟着收：别把 dev server 留在后台占端口。
        if (!server.killed && server.exitCode === null) server.kill("SIGTERM");
        resolve(code ?? (signal === null ? 0 : 1));
      });
      // 信号也要打到壳：Ctrl+C 在终端里只到得了前台进程组，壳可能没收到。
      const forward = (): void => {
        if (!child.killed && child.exitCode === null) child.kill("SIGTERM");
      };
      process.once("SIGINT", forward);
      process.once("SIGTERM", forward);
    });
  }

  /**
   * 确保壳的 userData 目录存在（Electron 的 `setPath` 不会替你建目录）。
   *
   * 默认值 `<appData>/<desktop.id>/dev/electron`（**不住产物根**：`runBuild` 会整目录删掉
   * `node_modules/.zephyr`）；**显式 `ZEPHYR_DESKTOP_USER_DATA` 优先**——多工作区并行、临时 profile
   * 都靠它，不靠自动隔离。
   * @returns 绝对路径。
   * @throws CliError 显式值为空且配置里没有 `desktop.id`（目录按它算）。
   */
  private async ensureUserData(): Promise<string> {
    const fromEnv = process.env.ZEPHYR_DESKTOP_USER_DATA;
    const explicit = fromEnv === undefined || fromEnv === "" ? undefined : fromEnv;
    const dir =
      explicit ??
      userDataDirOf(
        appRootOf({
          appDataHome: appDataHomeOf(process.env, process.platform, homedir()),
          desktopId: this.desktopIdOf(),
          form: "dev",
        }),
      );
    await mkdir(dir, { recursive: true });
    this.logger.info(
      "[desktop dev] userData：%s（%s）",
      dir,
      explicit === undefined ? "缺省 <appData>/<desktop.id>/dev/electron" : "显式指定",
    );
    return dir;
  }

  /**
   * 桌面身份的应用 id（应用根的第一段）。
   * @returns 反向域名 id。
   * @throws CliError 配置里没有 `desktop` 段。
   */
  private desktopIdOf(): string {
    const desktopId = this.resolved.config.desktop?.id;
    if (desktopId === undefined) {
      throw new CliError(
        "桌面形态需要 desktop.id：userData 的应用根按它算（或用 ZEPHYR_DESKTOP_USER_DATA 显式指定）。",
      );
    }
    return desktopId;
  }

  /**
   * 起 dev server 子进程（自己再跑一次 CLI 的 `dev`）。
   * @param port - 期望的端口。
   * @returns 子进程。
   */
  private startDevServer(port: number): ChildProcess {
    // 用 `pnpm exec` 而不是 `node <cli.ts>`：开发期 CLI 是 TS（要靠 pnpm 注入的 oxc 注册钩子），
    // 发布形态是 dist 里的 js。两条路对调用方的写法一致。
    // 端口走**外部环境**：`WebStartupDefault` 读 `PORT`（它的值不是构造参数，`configure` 对它无效）。
    // 桌面形态因此永远拿随机端口，不会和别的 dev server 撞。
    return spawn("pnpm", ["exec", "zephyr", "dev", this.mode.workspace], {
      stdio: "inherit",
      env: { ...process.env, PORT: String(port) },
      cwd: this.mode.workspace,
    });
  }

  /**
   * 等页面端口可用。
   * @param port - 端口。
   */
  private async waitForServer(port: number): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}/`);
        if (response.ok) return;
      } catch {
        // 还没起来。
      }
      if (Date.now() > deadline) {
        throw new CliError(
          `dev server 60s 内没起来（http://127.0.0.1:${String(port)}/）：先单独跑一次 zephyr dev 看报错。`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * electron 可执行文件：`electron` 包在 Node 里 export 出来就是它的二进制路径。
 * @returns 可执行文件路径。
 */
function resolveElectron(): string {
  const require = createRequire(import.meta.url);
  try {
    const executable = require("electron") as string;
    // 二进制没下载完时，electron 的 index.js 会给出 `undefined`（或 `.js` 自身）——那会以 Node 身份跑。
    return executable;
  } catch {
    throw new CliError("没有装 electron：desktop dev 需要它（peerDependency）。");
  }
}

/**
 * 本仓库的 TS 运行时入口（`register.mjs`）：壳里加载 `.ts` 靠它。
 * @returns `register.mjs` 的绝对路径；没装就是 `undefined`。
 */
function resolveLoader(): string | undefined {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("@morlay/dsh-oxc-node");
  } catch {
    return undefined;
  }
}

/**
 * 壳的主进程入口：由壳包自己的 `main` 字段决定（产物是 `dist/main.mjs`）。
 * @returns 入口绝对路径。
 */
function resolveShellMain(): string {
  const require = createRequire(import.meta.url);
  try {
    const manifestPath = require.resolve("@morlay/zephyr-desktop-shell/package.json");
    const manifest = require(manifestPath) as { main?: string };
    return join(dirname(manifestPath), manifest.main ?? "dist/main.mjs");
  } catch {
    throw new CliError("没有找到 @morlay/zephyr-desktop-shell：桌面形态需要它。");
  }
}

// `zephyr dev`：起开发形态。
//
// 命令本身很薄：读应用清单 → 叠上 `devProviders()` 装配一棵树 → **`startDev()` 起会话** → 接上树里的 `DevHmr` → 等信号。
// 三件事各归各家：装配归 CLI（它知道清单从哪个文件来）、启动与收尾归 `@morlay/zephyr-dev` 的
// `startDev()`（端口、地址、幂等 close 是开发运行时的事实）、换树护栏归 CLI（「先拆后起、卡住就退出」
// 是流程事实，不该每个应用抄一遍）。
import { join } from "node:path";
import { bootstrapApplication, inject, Injectable, Logger, type App } from "@morlay/zephyr";
import { devProviders, startDev, type DevSession } from "@morlay/zephyr-dev/node";
import { DevHmr } from "@morlay/zephyr-app";
import { Command, type CommandInput } from "../command.ts";
import { loadServerProviders } from "../server-entry.ts";
import { CliError } from "../errors.ts";
import { CliMode } from "../mode.ts";
import type { ParamSpecs } from "../params.ts";
import { Workspace } from "../config/contract.ts";

/** 拆旧树的预算：卡住的表现是「进程还在、端口不监听」，浏览器那边只有白屏。 */
const DISPOSE_TIMEOUT_MS = 20_000;

/** 装配的预算：同上，但更宽——首次装配要解析整棵依赖图。 */
const BOOTSTRAP_TIMEOUT_MS = 60_000;

/** 一棵起好的树 + 它的会话（换树时两者一起换）。 */
interface Running {
  readonly app: App;
  readonly session: DevSession;
}

/** `zephyr dev`。 */
@Injectable({ multi: true })
export class DevCommand extends Command {
  readonly path = ["dev"];

  readonly description = "起开发形态：装配应用清单（含 vite HMR），服务端源码变更时整棵换树";

  readonly params: ParamSpecs = {};

  private readonly mode = inject(CliMode);

  private readonly resolved = inject(Workspace);

  private readonly logger = inject(Logger);

  /**
   * @returns 退出码。
   */
  async run(_input: CommandInput): Promise<number> {
    let version = 0;
    let running = await this.start(version);
    let detach: (() => void) | undefined;
    // 换树口只在开发形态存在（生产形态不装开发运行时，`DevHmr` 就没人提供）。
    const attach = (): (() => void) | undefined => {
      // `install` 允许不返回撤销函数（没有变更来源时无事可撤）：统一成「有或没有」。
      const detached = running.app.tryGet(DevHmr)?.install({ restart });
      return typeof detached === "function" ? detached : undefined;
    };
    // 换树：拆旧树 → 起新树 → **在新树上重装**——新树是另一个 `DevHmr` 实例，旧的随旧树 dispose 了，
    // 不重装就只有第一次重载生效。
    const restart = async (files: readonly string[]): Promise<void> => {
      this.logger.warn("[dev] 开始重载：先拆旧树（端口即将关闭）：%s", files.join(", "));
      const startedAt = Date.now();
      // 收树用 `session.close()` 而不是 `app.dispose()`：撤路由、停 vite、释放端口是同一步，
      // 会话是那条路径的唯一入口（`app` 仍要留着重新装配用）。
      await withDeadline(running.session.close(), DISPOSE_TIMEOUT_MS, "旧树 dispose");
      version += 1;
      running = await this.start(version);
      detach = attach();
      this.logger.info("[dev] 重载完成，用时 %dms", Date.now() - startedAt);
    };
    detach = attach();
    await waitForSignal();
    this.logger.info("[dev] 收到退出信号，开始收尾");
    detach?.();
    // 收尾也给上限：某个行卡住时（历史上是 http server 等 keep-alive 连接）不该让 Ctrl+C 变成挂起。
    await withDeadline(running.session.close(), DISPOSE_TIMEOUT_MS, "退出收尾");
    this.logger.info("[dev] 已退出");
    return 0;
  }

  /**
   * 装配一棵树并起会话（端口、地址、幂等 close 全在 `startDev()` 里）。
   * @param version - 缓存失效用的版本（重载时必须换，否则 import 拿回同一个模块）。
   * @returns 树与会话。
   */
  private async start(version: number): Promise<Running> {
    // **形态由启动器注入**（设计 §四）：dev 的那几行叠在应用清单**之前**，应用源码因此不写
    // `mode.dev ? … : …`；build 把生产态那几行写进 `bootstrap.mjs`。
    const declared = await loadServerProviders(this.resolved.serverEntry, this.mode, version);
    const devMode = this.mode.packaged === undefined ? {} : { packaged: this.mode.packaged };
    const providers = [...devProviders(devMode), ...declared];
    const app = await withDeadline(
      bootstrapApplication({ providers, timeoutMs: BOOTSTRAP_TIMEOUT_MS }),
      BOOTSTRAP_TIMEOUT_MS,
      "bootstrapApplication",
    );
    this.logger.info(
      "[dev] 已装配 %d 行（含 dev 行 %d）",
      providers.length,
      providers.length - declared.length,
    );
    const session = await startDev({
      app,
      repoRoot: this.mode.workspace,
      cacheDir: this.cacheDirOf(),
      appRoot: join(this.mode.profileDir, "src", "client"),
      dataDir: this.mode.dataDir,
      ...(this.mode.port === undefined ? {} : { port: this.mode.port }),
      ...(this.mode.host === undefined ? {} : { host: this.mode.host }),
    });
    return { app, session };
  }

  /**
   * vite 的缓存目录：与树里的 `AppEnv.cacheDirOf("vite")` 是同一个地方。
   *
   * 这里重算一次是因为 `startDev()` 要拿它**核对**装配根（两个值对不上就当场报错）——
   * 不重算就等于「核对自己」，那一步永远绿。规则只有一条（`<dataDir>/cache/<namespace>`），
   * 漂移由 `startDev()` 的 `assertFacts` 兜住。
   * @returns 绝对路径。
   */
  private cacheDirOf(): string {
    return join(this.mode.dataDir, "cache", "vite");
  }
}

/**
 * 给不返回的 Promise 加护栏。
 * @param work - 待等待的动作。
 * @param ms - 上限。
 * @param what - 超时信息里要说的那一步。
 * @returns `work` 的结果。
 */
async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CliError(`${what} 超过 ${String(ms)}ms 没有返回`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 等一个退出信号。
 * @returns 收到信号即 resolve。
 */
function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

// `zephyr dev`：起开发形态。
//
// 命令本身很薄：读应用清单 → 装配 → 把重载口交给应用 → 等信号。**HMR 属于应用**（它对 vite 与
// 行树的关系最有把握），而「先拆后起、卡住就退出」这两条护栏属于 CLI——它们是流程事实，
// 不该每个应用抄一遍。
import { bootstrapApplication, inject, Injectable, Logger, type App } from "@morlay/zephyr";
import { Command, type CommandInput } from "../command.ts";
import { loadServerProviders } from "../server-entry.ts";
import { DevLifecycle } from "../dev-lifecycle.ts";
import { CliError } from "../errors.ts";
import { CliMode } from "../mode.ts";
import type { ParamSpecs } from "../params.ts";
import { Workspace } from "../config/contract.ts";

/** 拆旧树的预算：卡住的表现是「进程还在、端口不监听」，浏览器那边只有白屏。 */
const DISPOSE_TIMEOUT_MS = 20_000;

/** 装配的预算：同上，但更宽——首次装配要解析整棵依赖图。 */
const BOOTSTRAP_TIMEOUT_MS = 60_000;

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
    let app = await this.start(version);
    const lifecycle = app.tryGet(DevLifecycle);
    await lifecycle?.install({
      restart: async (files) => {
        this.logger.warn("[dev] 开始重载：先拆旧树（端口即将关闭）：%s", files.join(", "));
        const startedAt = Date.now();
        await withDeadline(app.dispose(), DISPOSE_TIMEOUT_MS, "旧树 dispose");
        version += 1;
        app = await this.start(version);
        this.logger.info("[dev] 重载完成，用时 %dms", Date.now() - startedAt);
      },
    });
    await waitForSignal();
    await app.dispose();
    return 0;
  }

  /**
   * 装配一棵树。
   * @param version - 缓存失效用的版本（重载时必须换，否则 import 拿回同一个模块）。
   * @returns 装配结果。
   */
  private async start(version: number): Promise<App> {
    const providers = await loadServerProviders(this.resolved.serverEntry, this.mode, version);
    const app = await withDeadline(
      bootstrapApplication({ providers, timeoutMs: BOOTSTRAP_TIMEOUT_MS }),
      BOOTSTRAP_TIMEOUT_MS,
      "bootstrapApplication",
    );
    this.logger.info("[dev] 已装配 %d 行", providers.length);
    return app;
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

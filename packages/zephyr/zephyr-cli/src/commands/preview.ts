// `zephyr preview`：只吃已有产物（缺了就报错，不顺手 build）。
//
// 「preview 不自动 build」是刻意的：preview 的用途是**验证产物**，如果它自己会重建，
// 「我明明 build 过，怎么还是旧页面」这类问题就永远排不掉了。
import { access } from "node:fs/promises";
import { bootstrapApplication, inject, Injectable, Logger } from "@morlay/zephyr";
import { Command, type CommandInput } from "../command.ts";
import { Workspace } from "../config/contract.ts";
import { CliError } from "../errors.ts";
import { CliMode } from "../mode.ts";
import type { ParamSpecs } from "../params.ts";
import { loadServerProviders } from "../server-entry.ts";

/** `zephyr preview`。 */
@Injectable({ multi: true })
export class PreviewCommand extends Command {
  readonly path = ["preview"];

  readonly description = "跑上一轮 build 的产物（.zephyr/runtime/entry.mjs）与静态面";

  readonly params: ParamSpecs = {};

  private readonly resolved = inject(Workspace);

  private readonly mode = inject(CliMode);

  private readonly logger = inject(Logger);

  /**
   * @returns 退出码。
   */
  async run(_input: CommandInput): Promise<number> {
    const entry = this.resolved.layout.entry;
    if (!(await readable(entry))) {
      throw new CliError(`没有找到 ${entry}：preview 只吃已有产物，先跑 zephyr build。`);
    }
    await installSourceLoader();
    // 产物入口导出的是清单（或 `(mode) => 清单`）：preview 与 dev 走同一条装配路径，
    // 差别只在装配根是闭包而不是源码树。
    const providers = await loadServerProviders(entry, this.mode);
    const app = await bootstrapApplication({ providers, timeoutMs: 60_000 });
    this.logger.info("[preview] 已起在产物上：%s", this.resolved.layout.dist);
    await waitForSignal();
    await app.dispose();
    return 0;
  }
}

/**
 * 装本仓库的 TS 运行时入口。
 *
 * 闭包里的包仍以**源码面**发布（`exports` 指 `src/*.ts`），而 Node 内建的类型剥离拒绝进入
 * `node_modules`（`@oxc-node/core` 也刻意放行那类文件）。`@morlay/dsh-oxc-node` 就是为此存在的：
 * 它自己注册 hooks、直接调 `oxc-transform`。
 * @throws CliError 装不上（缺依赖时要说清是哪一步）。
 */
async function installSourceLoader(): Promise<void> {
  // 按**变量**动态 import：它只有 `register.mjs`（没有类型声明），字面量形式会让 tsc 要求一份 d.ts。
  const entry: string = "@morlay/dsh-oxc-node";
  try {
    await import(entry);
  } catch (error) {
    throw new CliError(
      `preview 需要 @morlay/dsh-oxc-node 才能加载闭包里的 .ts：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 产物入口在不在。
 * @param path - 绝对路径。
 * @returns 判断结果。
 */
async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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

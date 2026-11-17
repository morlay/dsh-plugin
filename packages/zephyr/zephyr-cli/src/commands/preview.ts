// `zephyr preview`：只吃已有产物（缺了就报错，不顺手 build）。
//
// 「preview 不自动 build」是刻意的：preview 的用途是**验证产物**，如果它自己会重建，
// 「我明明 build 过，怎么还是旧页面」这类问题就永远排不掉了（设计「四、行为与边界」）。
//
// 它跑的是 `<outputDir>/bootstrap.mjs`——**生产态那一份装配**（不是应用清单）：
// 静态目录投递与部署值都在里面，preview 与桌面壳因此跑的是同一个入口。
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { inject, Injectable, Logger, type App } from "@morlay/zephyr";
import { Command, type CommandInput } from "../command.ts";
import { Workspace } from "../config/contract.ts";
import { CliError } from "../errors.ts";
import { CliMode } from "../mode.ts";
import type { ParamSpecs } from "../params.ts";

/** `zephyr preview`。 */
@Injectable({ multi: true })
export class PreviewCommand extends Command {
  readonly path = ["preview"];

  readonly description = "跑上一轮 build 的产物（<outputDir>/bootstrap.mjs + client_modules/）";

  readonly params: ParamSpecs = {};

  private readonly resolved = inject(Workspace);

  private readonly mode = inject(CliMode);

  private readonly logger = inject(Logger);

  /**
   * @returns 退出码。
   */
  async run(_input: CommandInput): Promise<number> {
    // 启动前校验：产物缺哪一样都当场报错，**不回退到现场编译**（判据 7）。
    await assertArtifacts(this.resolved.layout);
    await installSourceLoader();
    const app = await bootFromArtifact(this.resolved.layout.bootstrap, this.mode);
    this.logger.info("[preview] 已起在产物上：%s", this.resolved.layout.root);
    await waitForSignal();
    await app.dispose();
    return 0;
  }
}

/**
 * 跑产物里的装配文件：它默认导出 `(mode) => App`（装配完的行树）。
 * @param bootstrap - `bootstrap.mjs` 的绝对路径。
 * @param mode - 本次运行的部署参数。
 * @returns 装配好的应用。
 * @throws CliError 入口没有导出装配函数，或它没返回一个可卸载的应用。
 */
async function bootFromArtifact(bootstrap: string, mode: unknown): Promise<App> {
  const module = (await import(pathToFileURL(bootstrap).href)) as { default?: unknown };
  const boot = module.default;
  if (typeof boot !== "function") {
    throw new CliError(
      `${bootstrap} 没有导出装配函数：bootstrap.mjs 应当 export default (mode) => 装配好的应用（由 zephyr build 生成）。`,
    );
  }
  const app = (await (boot as (input: unknown) => Promise<unknown>)(mode)) as
    | { dispose?: () => Promise<void> }
    | undefined;
  if (app === undefined || typeof app.dispose !== "function") {
    throw new CliError(`${bootstrap} 的装配函数没有返回可卸载的应用（缺 dispose）。`);
  }
  return app as App;
}

/**
 * 产物齐不齐：`bootstrap.mjs` 与 `client_modules/` 缺一个就报错。
 *
 * 只校验这两样：它们是 `preview` 真正要读的（装配文件 + 前端静态目录）；闭包与源码面入口由
 * 启动链路自己报（缺了会是一句「解析不到 `@morlay/zephyr`」，比这里更具体）。
 * @param layout - 产物布局。
 * @throws CliError 缺产物（指出缺哪个与怎么补）。
 */
async function assertArtifacts(layout: {
  readonly root: string;
  readonly bootstrap: string;
  readonly clientModules: string;
}): Promise<void> {
  const missing: string[] = [];
  if (!(await readable(layout.bootstrap))) missing.push(`bootstrap.mjs（${layout.bootstrap}）`);
  if (!(await readable(layout.clientModules))) {
    missing.push(`client_modules/（${layout.clientModules}）`);
  }
  if (missing.length === 0) return;
  throw new CliError(
    `产物不齐（${layout.root}）：缺 ${missing.join("、")}。preview 只吃已有产物，先跑 zephyr build。`,
  );
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
  const failure = await import(entry).then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  if (failure !== undefined) {
    throw new CliError(`preview 需要 @morlay/dsh-oxc-node 才能加载闭包里的 .ts：${failure}`);
  }
}

/**
 * 产物在不在。
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

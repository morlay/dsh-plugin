// 壳的**调试面**：一个开关决定「日志与渲染 console 有多吵」，而不是在代码里到处 `if`。
//
// 它是 {@link DevMode} 的**只读投影**：三源合并、运行期切换与持久化都在 `dev-mode.ts`，这里只在每次
// 说话时读一次 `enabled`——所以菜单里打开开发者模式之后，日志立刻开始出现（不必重启）。
//
// 原则（多形态靠**外部环境**适配）：壳的形态差异只从环境变量来——`ZEPHYR_DESKTOP_MODE`（dev /
// packaged）。中间逻辑（装配、协议、宿主）不为某个形态改分支。

/** 调试面的来源：只读 `enabled`（`DevMode` 结构上就是它，这里不引入依赖方向）。 */
export interface ShellDebugSource {
  /** 此刻要不要吵。 */
  readonly enabled: boolean;
}

/** 壳的调试面。 */
export interface ShellDebug {
  /** 是否打开调试面：渲染进程 console 转发 + DevTools + 生命周期日志。 */
  readonly enabled: boolean;

  /**
   * 打一条壳自己的日志（`[shell]` 前缀，stderr）。
   * @param message - 文本。
   */
  log(message: string): void;

  /**
   * 打一条**始终可见**的错误（不受 `enabled` 控制：错误不该被开关吞掉）。
   * @param message - 文本。
   */
  fail(message: string): void;

  /**
   * 转发一条渲染进程的 console。
   * @param message - 文本。
   */
  renderer(message: string): void;
}

/**
 * 造调试面：只读投影，不持有状态。
 * @param source - 开发者模式（读它的 `enabled`）。
 * @returns 调试面。
 */
export function shellDebugOf(source: ShellDebugSource): ShellDebug {
  return {
    get enabled(): boolean {
      return source.enabled;
    },
    log: (message) => {
      if (source.enabled) process.stderr.write(`[shell] ${message}\n`);
    },
    fail: (message) => process.stderr.write(`[shell] ${message}\n`),
    renderer: (message) => {
      if (source.enabled) process.stderr.write(`[renderer] ${message}\n`);
    },
  };
}

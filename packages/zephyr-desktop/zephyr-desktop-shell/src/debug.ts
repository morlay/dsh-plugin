// 壳的**调试面**：一个开关决定「日志与 DevTools 有多吵」，而不是在代码里到处 `if`。
//
// 原则（多形态靠**外部环境**适配）：壳的形态差异只从环境变量来——`ZEPHYR_DESKTOP_MODE`（dev /
// packaged）、`ZEPHYR_DESKTOP_DEBUG`（调试面）。中间逻辑（装配、协议、宿主）不为某个形态改分支。

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
 * 读环境变量造调试面。
 * @param env - 环境变量（测试可注入）。
 * @returns 调试面。
 */
export function shellDebugOf(env: NodeJS.ProcessEnv = process.env): ShellDebug {
  const enabled = env.ZEPHYR_DESKTOP_DEBUG === "1";
  return {
    enabled,
    log: (message) => {
      if (enabled) process.stderr.write(`[shell] ${message}\n`);
    },
    fail: (message) => process.stderr.write(`[shell] ${message}\n`),
    renderer: (message) => {
      if (enabled) process.stderr.write(`[renderer] ${message}\n`);
    },
  };
}

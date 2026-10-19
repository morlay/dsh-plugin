// 有界、可升级的进程退出：长驻宿主进程的收尾只走这一处。
//
// 与上游 apps/cli 里那份同语义（先优雅 dispose，超时则强退；重复信号升级为强退），自己实现是为了不再依赖
// 那个 private 的应用包。

/** 树优雅 dispose 的上限；超过就强退。 */
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000;

/** 正常完成与 Unix 信号共用的退出控制器。 */
export interface ProcessShutdown {
  /** 启动或汇入优雅收尾，然后允许进程以 `code` 自然结束。 */
  shutdown(code: number): Promise<void>;
  /** 启动优雅收尾并随后退出；若收尾已在跑，直接强退。 */
  interrupt(code: number): void;
}

/**
 * 围绕一个应用 disposer 造退出控制器。
 * @param dispose - 整棵树的收尾，resolve 即静止。
 * @param forceExit - 立即退出进程（测试可替换）。
 * @param complete - 记录自然结束码（测试可替换）。
 * @param timeoutMs - 强退前的宽限（测试可替换）。
 * @returns 正常调用会合并、重复信号会升级的控制器。
 */
export function createProcessShutdown(
  dispose: () => Promise<void>,
  forceExit: (code: number) => void = (code) => {
    process.exit(code);
  },
  complete: (code: number) => void = (code) => {
    process.exitCode = code;
  },
  timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS,
): ProcessShutdown {
  let pending: Promise<void> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  let forceExited = false;

  const clearExitTimeout = (): void => {
    if (timeout !== undefined) clearTimeout(timeout);
  };

  const forceExitOnce = (code: number): void => {
    if (forceExited) return;
    forceExited = true;
    clearExitTimeout();
    forceExit(code);
  };

  const completeOnce = (code: number): void => {
    if (completed || forceExited) return;
    completed = true;
    clearExitTimeout();
    complete(code);
  };

  const start = (code: number, forceAfterDispose: boolean): Promise<void> => {
    if (pending !== undefined) return pending;
    timeout = setTimeout(() => {
      forceExitOnce(code);
    }, timeoutMs);
    pending = Promise.resolve()
      .then(dispose)
      .then(
        () => {
          if (forceAfterDispose) forceExitOnce(code);
          else completeOnce(code);
        },
        () => {
          forceExitOnce(code);
        },
      );
    return pending;
  };

  return {
    shutdown(code) {
      return start(code, false);
    },
    interrupt(code) {
      if (pending !== undefined) {
        forceExitOnce(code);
        return;
      }
      void start(code, true);
    },
  };
}

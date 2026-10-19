// 桌面形态的 **IPC 面**：只剩两条——"向壳发事件"（`ready` / `fatal`）与"收尾"。
//
// 以前这里还有一条请求/响应字节管道（FD 3/4）：页面的请求经它喂给宿主内的 `webServer`。那条路已退休——
// 窗口现在从宿主真 webServer 的 origin（`http://127.0.0.1:<port>`）载入，请求直连它本身；管道留下的
// 唯一后果是"没有 origin"，而基于 URL/WS 的东西（settings 的 describe 流、账号的 stream mux、vite 的
// HMR）拿不到答复。判据与取舍见 `../config/desktop.cordis.patch.yml` 的注释。

import type { AppProfileBoot } from "@morlay/dsh-app-boot";
import { applyInspectorCommand, closeInspectorEndpoint } from "./inspector.ts";
import { isDesktopHostCommand, type DesktopHostEvent } from "./wire.ts";

/** 接上壳那条 IPC 通道要什么。 */
export interface DesktopIpcOptions {
  /** 装配结果：收尾时取它的 `shutdown`（尚未 settle 也照等，装配失败只当作没有树可停）。 */
  readonly application: Promise<AppProfileBoot>;
}

/** 接好之后的信道两头。 */
export interface DesktopIpc {
  /** 向壳发事件（`ready` / `fatal`）。 */
  readonly send: (event: DesktopHostEvent) => void;
  /** 收尾：停树、断开 IPC 通道；幂等。 */
  readonly stop: (exitCode?: number) => Promise<void>;
}

/**
 * 接上 IPC 面：挂好生命周期（`shutdown` 命令 / 通道断开）。
 * @param options - 装配结果。
 * @returns 发事件与收尾两个入口。
 */
export function connectDesktopIpc(options: DesktopIpcOptions): DesktopIpc {
  const { application } = options;
  let stopping: Promise<void> | undefined;

  const send = (event: DesktopHostEvent): void => {
    if (process.send === undefined || !process.connected) return;
    try {
      process.send(event);
    } catch (error) {
      // 父进程并发断开时只吞掉通道已关闭这一种；其余照常抛出。
      if ((error as NodeJS.ErrnoException).code !== "ERR_IPC_CHANNEL_CLOSED") throw error;
    }
  };

  const stop = (exitCode = 0): Promise<void> => {
    stopping ??= (async () => {
      closeInspectorEndpoint();
      const running = await application.catch(() => undefined);
      await running?.shutdown.shutdown(exitCode);
      if (process.connected) process.disconnect?.();
      process.exitCode = exitCode;
    })();
    return stopping;
  };

  process.on("message", (message: unknown) => {
    if (!isDesktopHostCommand(message)) return;
    // 调试端点命令先于 shutdown 分派：它们只影响回环上的 Node inspector。
    const inspected = applyInspectorCommand(message);
    if (inspected !== undefined) {
      send(inspected);
      return;
    }
    if (message.type === "shutdown") void stop();
  });
  process.once("disconnect", () => {
    void stop();
  });

  return { send, stop };
}

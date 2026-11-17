// 渲染进程的桥：**只暴露桌面独有的能力**（目录选择器 + 平台标记），不碰 node。
import { contextBridge, ipcRenderer } from "electron";
import { browserPaneBridgeOf } from "./browser-pane-bridge.ts";
import { markDocument } from "./document-marks.ts";
import { DESKTOP_IPC } from "./ipc.ts";

contextBridge.exposeInMainWorld("__DSH_DIRECTORY_PICKER__", {
  pick: () => ipcRenderer.invoke(DESKTOP_IPC.directoryPick) as Promise<string | null>,
});

// `__DSH_BROWSER_PANE__`：内嵌浏览器面板的五个意图（开 / 摆位置 / 导航 / 关 / 读状态）与唯一一条 state 订阅。
// 它**只转发**：协议白名单、单实例、权限与生命周期全在主进程那一侧（`browser-pane*.ts`）。
contextBridge.exposeInMainWorld("__DSH_BROWSER_PANE__", browserPaneBridgeOf(ipcRenderer));

// `dshDesktop`：上游 client 行（`@deepseek-ai/dsh-client-shortcuts`）在 desktop 运行时要求的桥。
// 缺 `shortcuts` 时那一行**构造失败**，所以这张面是桌面形态的必需项，不是可选装饰。
contextBridge.exposeInMainWorld("dshDesktop", {
  protocolVersion: 1,
  shortcuts: {
    get: (definitions: unknown) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsGet, definitions),
    edit: (edit: unknown, revision: unknown) =>
      ipcRenderer.invoke(DESKTOP_IPC.shortcutsEdit, edit, revision),
    recording: (active: boolean) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsRecording, active),
    subscribe: (listener: (snapshot: unknown) => void): (() => void) => {
      const handler = (_event: unknown, snapshot: unknown): void => listener(snapshot);
      ipcRenderer.on(DESKTOP_IPC.shortcutsChanged, handler);
      return () => {
        ipcRenderer.off(DESKTOP_IPC.shortcutsChanged, handler);
      };
    },
  },
  keyboard: {
    subscribe: (listener: (input: unknown) => void): (() => void) => {
      const handler = (_event: unknown, input: unknown): void => listener(input);
      ipcRenderer.on(DESKTOP_IPC.shortcutsInput, handler);
      return () => {
        ipcRenderer.off(DESKTOP_IPC.shortcutsInput, handler);
      };
    },
    closeWindow: (revision: unknown) =>
      ipcRenderer.invoke(DESKTOP_IPC.shortcutsCloseWindow, revision),
  },
});

if (typeof document !== "undefined") {
  if (document.documentElement !== null) {
    markDocument(document, process.platform);
  } else {
    document.addEventListener("DOMContentLoaded", () => markDocument(document, process.platform));
  }
}

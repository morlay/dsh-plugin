import { contextBridge, ipcRenderer } from "electron";
import { markDocumentPlatform, markWindowsTitlebar, syncNativeTheme } from "./document-marks.ts";
import { DESKTOP_IPC, SCHEME } from "./ipc.ts";

interface StreamChunk {
  readonly id: number;
  readonly status?: number;
  readonly data?: string;
  readonly message?: string;
}

if (location.protocol === `${SCHEME}:` && location.hostname === "app") {
  contextBridge.exposeInMainWorld("__DSH_DIRECTORY_PICKER__", {
    pick: () => ipcRenderer.invoke(DESKTOP_IPC.directoryPick) as Promise<string | null>,
  });
  // 页面 fetch 到自定义协议时请求体不可靠（POST 场景会挂住），桌面流改走主进程。
  contextBridge.exposeInMainWorld("__DSH_DESKTOP_STREAM__", {
    open(
      endpoint: string,
      payload: unknown,
      handlers: {
        chunk(text: string): void;
        end(): void;
        fail(message: string): void;
      },
    ): () => void {
      let id: number | undefined;
      let cancelled = false;
      const onChunk = (_event: unknown, value: StreamChunk): void => {
        if (value.id !== id || value.data === undefined) return;
        handlers.chunk(value.data);
      };
      const onEnd = (_event: unknown, value: StreamChunk): void => {
        if (value.id === id) handlers.end();
      };
      const onError = (_event: unknown, value: StreamChunk): void => {
        if (value.id === id) handlers.fail(value.message ?? "desktop stream failed");
      };
      ipcRenderer.on(DESKTOP_IPC.streamChunk, onChunk);
      ipcRenderer.on(DESKTOP_IPC.streamEnd, onEnd);
      ipcRenderer.on(DESKTOP_IPC.streamError, onError);
      void ipcRenderer
        .invoke(DESKTOP_IPC.streamOpen, endpoint, payload)
        .then((opened: unknown) => {
          id = opened as number;
          if (cancelled) ipcRenderer.send(DESKTOP_IPC.streamCancel, id);
        })
        .catch((error: unknown) => {
          handlers.fail(error instanceof Error ? error.message : String(error));
        });
      return () => {
        cancelled = true;
        ipcRenderer.off(DESKTOP_IPC.streamChunk, onChunk);
        ipcRenderer.off(DESKTOP_IPC.streamEnd, onEnd);
        ipcRenderer.off(DESKTOP_IPC.streamError, onError);
        if (id !== undefined) ipcRenderer.send(DESKTOP_IPC.streamCancel, id);
      };
    },
  });
}

markDocumentPlatform(process.platform, document);
markWindowsTitlebar(process.platform, document);
syncNativeTheme(process.platform, document, (source) => {
  ipcRenderer.send(DESKTOP_IPC.nativeThemeSet, source);
});

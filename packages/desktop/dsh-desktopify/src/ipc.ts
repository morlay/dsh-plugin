import type { IpcMainInvokeEvent } from "electron";

export const DESKTOP_IPC = {
  directoryPick: "dsh-desktop:directory-pick",
  nativeThemeSet: "dsh-desktop:native-theme-set",
  /** 桌面流载体：页面把 Gateway 的流请求交给主进程，主进程用标准 Request 喂宿主。 */
  streamOpen: "dsh-desktop:stream-open",
  streamCancel: "dsh-desktop:stream-cancel",
  streamChunk: "dsh-desktop:stream-chunk",
  streamEnd: "dsh-desktop:stream-end",
  streamError: "dsh-desktop:stream-error",
} as const;

export const SCHEME = "dsh-app";

export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame;
  if (senderFrame === null) throw new Error("dsh desktop: rejected IPC without a sender frame");
  const url = new URL(senderFrame.url);
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error("dsh desktop: rejected IPC from an unowned renderer");
  }
}

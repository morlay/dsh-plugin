import type { IpcMainInvokeEvent } from "electron";

export const DESKTOP_IPC = {
  directoryPick: "dsh-desktop:directory-pick",
  nativeThemeSet: "dsh-desktop:native-theme-set",
  /** 桌面流载体：页面把 Gateway 的流请求交给主进程，主进程用标准 Request 喂宿主。 */
  streamOpen: "dsh-desktop:stream-open",
  streamCancel: "dsh-desktop:stream-cancel",
  /** 逻辑流的上行项（客户端 → 宿主），主进程把它们写成宿主请求体的后续行。 */
  streamUplink: "dsh-desktop:stream-uplink",
  /** 上行结束：主进程据此结束宿主请求体。 */
  streamUplinkEnd: "dsh-desktop:stream-uplink-end",
  streamChunk: "dsh-desktop:stream-chunk",
  streamEnd: "dsh-desktop:stream-end",
  streamError: "dsh-desktop:stream-error",
} as const;

/** preload 从渲染进程 argv 里读回 scheme 的参数名（主进程与 preload 共用一份）。 */
export const DESKTOP_SCHEME_ARGUMENT = "--dsh-desktop-scheme";

/**
 * 应用页面的自定义协议：取 app 工作区 package.json 的 name 派生，避免与官方桌面应用
 * 共用同一个 scheme。去 scope 前缀、转小写、非法字符换成 `-`；派生不出合法 scheme 就报错。
 */
export function desktopScheme(name: string): string {
  const bare = name
    .slice(name.lastIndexOf("/") + 1)
    .toLowerCase()
    .replaceAll(/[^a-z0-9+.-]/gu, "-");
  if (!/^[a-z][a-z0-9+.-]*$/u.test(bare))
    throw new Error(
      `dsh desktop: application name "${name}" does not yield a usable URL scheme (${bare})`,
    );
  return bare;
}

export function assertDesktopSender(
  event: IpcMainInvokeEvent,
  scheme: string,
  hostnames: readonly string[],
): void {
  const senderFrame = event.senderFrame;
  if (senderFrame === null) throw new Error("dsh desktop: rejected IPC without a sender frame");
  const url = new URL(senderFrame.url);
  if (url.protocol !== `${scheme}:` || !hostnames.includes(url.hostname)) {
    throw new Error("dsh desktop: rejected IPC from an unowned renderer");
  }
}

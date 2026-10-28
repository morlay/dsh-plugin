import type { IpcMainInvokeEvent } from "electron";

/** 壳把宿主回环的 ws 端口经 preload 递进页面（`additionalArguments`，与 scheme 同一手法）。 */
export const DESKTOP_WS_PORT_ARGUMENT = "--dsh-desktop-ws-port";

export const DESKTOP_IPC = {
  directoryPick: "dsh-desktop:directory-pick",
  nativeThemeSet: "dsh-desktop:native-theme-set",
  // 桌面流载体：页面把 Gateway 的流请求交给主进程，主进程用标准 Request 喂宿主。
  streamOpen: "dsh-desktop:stream-open",
  streamCancel: "dsh-desktop:stream-cancel",
  // 逻辑流的上行项（客户端 → 宿主），主进程把它们写成宿主请求体的后续行。
  streamUplink: "dsh-desktop:stream-uplink",
  // 上行结束：主进程据此结束宿主请求体。
  streamUplinkEnd: "dsh-desktop:stream-uplink-end",
  streamChunk: "dsh-desktop:stream-chunk",
  streamEnd: "dsh-desktop:stream-end",
  streamError: "dsh-desktop:stream-error",
  // 桌面快捷键：设备偏好的读写 / 录制状态（渲染进程 → 主进程）。
  shortcutsGet: "dsh-desktop:shortcuts-get",
  shortcutsEdit: "dsh-desktop:shortcuts-edit",
  shortcutsRecording: "dsh-desktop:shortcuts-recording",
  shortcutsCloseWindow: "dsh-desktop:shortcuts-close-window",
  // 命中的原生按键手势（主进程 → 渲染进程）；渲染侧的 native keyboard 适配器消费。
  shortcutsInput: "dsh-desktop:shortcuts-input",
  // 配置快照变化（主进程 → 渲染进程）。
  shortcutsChanged: "dsh-desktop:shortcuts-changed",
} as const;

// preload 从渲染进程 argv 里读回 scheme 的参数名（主进程与 preload 共用一份）。
export const DESKTOP_SCHEME_ARGUMENT = "--dsh-desktop-scheme";

// 应用页面的自定义协议：取 app 工作区 package.json 的 name 派生，避免与官方桌面应用
// 共用同一个 scheme。去 scope 前缀、转小写、非法字符换成 `-`；派生不出合法 scheme 就报错。
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

/**
 * 校验一次 IPC 来自**本应用的页面**：senderFrame 的 origin 必须在 `allowedOrigins` 里。
 *
 * 页面从宿主 webServer 的 origin（`http://127.0.0.1:<port>`）载入——早先那条自定义协议
 * `scheme://app/` 已经不再承载页面（它没有 origin，settings 的 describe 流拿不到答复）。所以这里比的是
 * origin，而不是 scheme + hostname：后者会让所有真实页面都被判成 unowned。
 * @param event - Electron 的 invoke 事件。
 * @param allowedOrigins - 允许的页面 origin（应用自己的宿主 origin）。
 */
export function assertDesktopSender(
  event: IpcMainInvokeEvent,
  allowedOrigins: readonly string[],
): void {
  const senderFrame = event.senderFrame;
  if (senderFrame === null) throw new Error("dsh desktop: rejected IPC without a sender frame");
  let origin: string;
  try {
    origin = new URL(senderFrame.url).origin;
  } catch {
    throw new Error("dsh desktop: rejected IPC with an unreadable sender URL");
  }
  if (!allowedOrigins.includes(origin)) {
    throw new Error("dsh desktop: rejected IPC from an unowned renderer");
  }
}

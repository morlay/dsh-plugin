// 桌面快捷键的原生侧（**桥**）：设备偏好持久化 + 读当前 + 录制状态 + 关窗。
//
// 页面侧的 `provideClientChain()` 含 `provideShortcuts()`，它在 desktop 运行时要求
// `window.dshDesktop.shortcuts` 存在（缺了构造失败）——所以这份桥在桌面形态是**必需**的。
// 语义全部复用上游的 `ShortcutPersistence`（不自己实现编辑/冲突的规则）。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ShortcutPersistence } from "@deepseek-ai/dsh-client-shortcuts/protocol";
import type {
  ShortcutConfigSnapshot,
  ShortcutPlatform,
  ShortcutRevision,
} from "@deepseek-ai/dsh-client-shortcuts/protocol";
import { DESKTOP_IPC } from "./ipc.ts";
import type { ElectronLike } from "./provide.ts";

/** 一个窗口实例（类型从 `ElectronLike` 派生）。 */
export type ShellWindow = InstanceType<ElectronLike["BrowserWindow"]>;

/** 装快捷键桥需要的部署值。 */
export interface ShortcutsHostOptions {
  readonly electron: ElectronLike;
  /** `userData`（`shortcuts.json` 落在这里）。 */
  readonly userData: string;
  /** 当前窗口（关窗与广播用）。 */
  readonly getWindow: () => ShellWindow | undefined;
  /** 平台（`ShortcutPlatform` 的字面量）。 */
  readonly platform?: NodeJS.Platform;
}

/** 桥的收尾操作。 */
export interface ShortcutsHost {
  /** 释放 IPC 与持久化。 */
  dispose(): void;
}

/**
 * 平台 → 快捷键平台字面量。
 * @param platform - `process.platform`。
 * @returns 上游协议里的平台名。
 */
export function shortcutPlatformOf(platform: NodeJS.Platform): ShortcutPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

/**
 * 装上快捷键桥。
 * @param options - electron 面、userData、窗口取值与平台。
 * @returns 收尾操作。
 */
export function installShortcuts(options: ShortcutsHostOptions): ShortcutsHost {
  const file = join(options.userData, "shortcuts.json");
  /** 最近一次广播出去的快照（关窗判据要用它的 revision）。 */
  let current: ShortcutConfigSnapshot | undefined;
  /** 页面是否在录制按键（录制中不拦任何键）。 */
  let recording = false;

  const publish = (snapshot: ShortcutConfigSnapshot): void => {
    current = snapshot;
    const window = options.getWindow();
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.send(DESKTOP_IPC.shortcutsChanged, snapshot);
    }
  };

  const persistence = new ShortcutPersistence(
    {
      read: () => readFile(file, "utf8").catch(() => null),
      write: (raw) => writeFile(file, raw, "utf8"),
    },
    "desktop",
    shortcutPlatformOf(options.platform ?? process.platform),
    true,
    publish,
  );

  const { ipcMain } = options.electron;
  ipcMain.handle(DESKTOP_IPC.shortcutsGet, async (event) => {
    if (!owns(options, event.senderId)) return persistence.readCurrent();
    return persistence.readCurrent();
  });
  ipcMain.handle(DESKTOP_IPC.shortcutsEdit, async (_event, edit: unknown, revision: unknown) => {
    if (typeof revision !== "string") throw new Error("shortcuts: invalid revision");
    return persistence.edit(edit as never, revision as ShortcutRevision);
  });
  ipcMain.handle(DESKTOP_IPC.shortcutsRecording, async (_event, active: unknown) => {
    recording = active === true;
    const window = options.getWindow();
    // 录制时把菜单快捷键让给页面（否则 ⌘W 之类的菜单项会先吃掉按键）。
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.setIgnoreMenuShortcuts(recording);
    }
  });
  ipcMain.handle(DESKTOP_IPC.shortcutsCloseWindow, async (_event, expected: unknown) => {
    const window = options.getWindow();
    if (window === undefined || window.isDestroyed()) return;
    // 三重判据（与参考一致）：配置仍是当前那份、非录制中、窗口在前台且可用。
    if (expected !== current?.revision || recording) return;
    if (!window.isFocused() || !window.isEnabled()) return;
    window.close();
  });

  return {
    dispose: () => persistence.dispose(),
  };
}

/**
 * 这个请求是不是我们自己那个窗口发来的。
 * @param options - 宿主选项（取当前窗口）。
 * @param senderId - `event.senderId`。
 * @returns 判断结果（没有 senderId 时按「无法确认」放行给持久化读）。
 */
function owns(options: ShortcutsHostOptions, senderId: number | undefined): boolean {
  const window = options.getWindow();
  if (window === undefined || window.isDestroyed() || senderId === undefined) return true;
  return window.webContents.id === senderId;
}

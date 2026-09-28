/**
 * 桌面快捷键的原生侧：设备偏好持久化 + 原生按键转发 + 关闭窗口动作。
 *
 * 上游 `@deepseek-ai/dsh-client-shortcuts` 在 `data-platform` 存在时按 desktop 运行时起服务，
 * 并**强制要求** `window.dshDesktop.keyboard`（缺了就构造失败）——这里就是那份契约的实现：
 * 主进程按已绑定键过滤物理按键，把命中的手势经 IPC 交给渲染进程派发。
 */
import { ipcMain, type BrowserWindow, type Input } from "electron";
import {
  bindingKey,
  effectiveShortcuts,
  parseShortcutDefinitions,
  parseShortcutEdit,
} from "@deepseek-ai/dsh-client-shortcuts/protocol";
import type {
  NormalizedBinding,
  ShortcutConfigSnapshot,
  ShortcutDefinition,
  ShortcutPlatform,
  ShortcutRevision,
} from "@deepseek-ai/dsh-client-shortcuts/protocol";
import { DESKTOP_IPC, assertDesktopSender } from "./ipc.ts";
import { desktopKeybindings } from "./keybindings.ts";

export interface DesktopShortcuts {
  /** 把一个窗口接进原生按键转发（每个新建的窗口都要接一次）。 */
  attach(window: BrowserWindow): void;
  /** 释放 IPC 与持久化（退出时调用）。 */
  dispose(): void;
}

/**
 * 装上桌面快捷键的原生侧。
 * @param getWindow - 当前主窗口。
 * @param userData - Electron 的 userData 目录。
 * @param platform - 本机输入平台。
 * @param scheme - 产品页面的自定义协议（校验 IPC 来源）。
 * @returns 窗口接入与释放操作。
 */
export function installDesktopShortcuts(
  getWindow: () => BrowserWindow | undefined,
  userData: string,
  platform: ShortcutPlatform,
  scheme: string,
): DesktopShortcuts {
  let definitions: readonly ShortcutDefinition[] = [];
  let recording = false;
  let revision: ShortcutRevision | undefined;
  let keys = new Set<string>();

  // 只有「已绑定、无冲突、无问题」的键才拦：其余一律放行给页面自己的处理。
  const publish = (snapshot: ShortcutConfigSnapshot): void => {
    revision =
      definitions.length === 0 || snapshot.status === "loading" ? undefined : snapshot.revision;
    const rows =
      snapshot.status === "loading"
        ? []
        : effectiveShortcuts(definitions, snapshot.document, "desktop", platform);
    keys = new Set(
      rows.flatMap((row) =>
        row.binding !== null && row.issue === null && row.conflicts.length === 0
          ? [bindingKey(row.binding)]
          : [],
      ),
    );
    const window = getWindow();
    if (window !== undefined && !window.isDestroyed())
      window.webContents.send(DESKTOP_IPC.shortcutsChanged, snapshot);
  };

  const persistence = desktopKeybindings(userData, platform, publish);

  const windowOf = (event: Electron.IpcMainInvokeEvent): BrowserWindow => {
    assertDesktopSender(event, scheme, ["app"]);
    const window = getWindow();
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents)
      throw new Error("desktop shortcuts: rejected sender");
    return window;
  };

  ipcMain.handle(DESKTOP_IPC.shortcutsGet, (event, input: unknown) => {
    windowOf(event);
    definitions = parseShortcutDefinitions(input);
    persistence.setDefinitions(definitions);
    return persistence.readCurrent();
  });
  ipcMain.handle(DESKTOP_IPC.shortcutsEdit, (event, input: unknown, expected: unknown) => {
    windowOf(event);
    if (typeof expected !== "string") throw new Error("desktop shortcuts: invalid revision");
    return persistence.edit(parseShortcutEdit(input), expected as ShortcutRevision);
  });
  ipcMain.handle(DESKTOP_IPC.shortcutsRecording, (event, active: unknown) => {
    const window = windowOf(event);
    if (typeof active !== "boolean") throw new Error("desktop shortcuts: invalid recording state");
    recording = active;
    window.webContents.setIgnoreMenuShortcuts(active);
  });
  ipcMain.handle(DESKTOP_IPC.shortcutsCloseWindow, (event, expected: unknown) => {
    const window = windowOf(event);
    if (expected !== revision || revision === undefined || recording) return;
    if (!window.isFocused() || !window.isEnabled()) return;
    window.close();
  });

  const attach = (window: BrowserWindow): void => {
    const contents = window.webContents;
    let deadKey = false;
    const held = new Set<string>();
    const consumed = new Map<string, "press" | "repeat">();
    const resetInput = (): void => {
      deadKey = false;
      held.clear();
      consumed.clear();
      if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(false);
    };
    const clear = (): void => {
      resetInput();
      definitions = [];
      keys.clear();
      recording = false;
      persistence.setDefinitions(null);
    };
    const beforeInput = (event: Electron.Event, input: Input): void => {
      if (event.defaultPrevented) {
        resetInput();
        return;
      }
      if (
        window !== getWindow() ||
        !window.isFocused() ||
        !window.isEnabled() ||
        revision === undefined
      ) {
        contents.setIgnoreMenuShortcuts(false);
        held.clear();
        consumed.clear();
        return;
      }
      const modifiers = (["control", "alt", "shift", "meta"] as const).filter(
        (modifier) => input[modifier],
      );
      const key = bindingKey({ code: input.code, modifiers });
      const match = keys.has(key);
      contents.setIgnoreMenuShortcuts(recording || match);
      const composing =
        input.isComposing || input.key === "Dead" || deadKey || input.modifiers.includes("altgr");
      if (input.type === "keyDown") deadKey = input.key === "Dead";
      if (recording || composing) {
        held.clear();
        consumed.clear();
        return;
      }
      let binding: NormalizedBinding = { code: input.code, modifiers };
      let priority = false;
      const modifierKey = /^(Control|Alt|Shift|Meta)(Left|Right)$/u.test(input.code);
      if (input.type === "keyUp") {
        // 组合键的第一个键到达过渲染进程，它的抬起也必须到达同一批输入处理。
        if (consumed.get(input.code) === "press") event.preventDefault();
        consumed.delete(input.code);
        held.delete(input.code);
        if (modifierKey) held.clear();
        return;
      }
      if (!input.isAutoRepeat) consumed.delete(input.code);
      if (modifierKey) {
        held.clear();
        return;
      }
      if (input.isAutoRepeat && consumed.has(input.code) && !match) {
        event.preventDefault();
        return;
      }
      if (input.isAutoRepeat && !held.has(input.code) && !match) return;
      held.add(input.code);
      const codes: [string, ...string[]] = [
        input.code,
        ...[...held].filter((value) => value !== input.code),
      ];
      codes.sort();
      const pair = {
        code: codes[0],
        ...(codes[1] === undefined ? {} : { secondCode: codes[1] }),
        modifiers,
      };
      priority = keys.has(key);
      if (codes.length === 2 && keys.has(bindingKey(pair))) {
        binding = pair;
        priority = true;
      }
      if (!priority) return;
      event.preventDefault();
      if (!input.isAutoRepeat) {
        if (binding.secondCode !== undefined) {
          consumed.set(binding.code, "repeat");
          consumed.set(binding.secondCode, "repeat");
        }
        consumed.set(input.code, "press");
      }
      // Electron 可能两个 keyup 都不再送来：已完成的按键不能拿来接下一个组合键。
      held.clear();
      contents.send(DESKTOP_IPC.shortcutsInput, {
        kind: "keyboard",
        revision,
        code: binding.code,
        ...(binding.secondCode === undefined ? {} : { secondCode: binding.secondCode }),
        repeat: input.isAutoRepeat,
        control: input.control,
        alt: input.alt,
        shift: input.shift,
        meta: input.meta,
      });
    };
    const navigation = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (event.isMainFrame && !event.isSameDocument) clear();
    };
    const disposeInput = (): void => {
      contents.off("did-start-navigation", navigation);
      contents.off("before-input-event", beforeInput);
      contents.off("blur", resetInput);
      resetInput();
    };
    contents.on("did-start-navigation", navigation);
    contents.on("before-input-event", beforeInput);
    contents.on("blur", resetInput);
    contents.once("destroyed", disposeInput);
    window.once("closed", clear);
  };

  return {
    attach,
    dispose() {
      for (const channel of [
        DESKTOP_IPC.shortcutsGet,
        DESKTOP_IPC.shortcutsEdit,
        DESKTOP_IPC.shortcutsRecording,
        DESKTOP_IPC.shortcutsCloseWindow,
      ])
        ipcMain.removeHandler(channel);
      persistence.dispose();
    },
  };
}

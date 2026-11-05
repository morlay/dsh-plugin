// 主进程与 preload 共用的通道名（放独立文件：preload 顶层有 contextBridge 调用，main 不能引它）。
export const DESKTOP_IPC = {
  /** 渲染进程请求一个原生目录选择框；返回绝对路径或 `null`。 */
  directoryPick: "dsh-desktop:directory-pick",
  /** 快捷键配置的读写（渲染进程 → 主进程）。 */
  shortcutsGet: "dsh-desktop:shortcuts-get",
  shortcutsEdit: "dsh-desktop:shortcuts-edit",
  shortcutsRecording: "dsh-desktop:shortcuts-recording",
  /** 配置快照变化（主进程 → 渲染进程）。 */
  shortcutsChanged: "dsh-desktop:shortcuts-changed",
  /** 命中的原生按键手势（主进程 → 渲染进程）。 */
  shortcutsInput: "dsh-desktop:shortcuts-input",
  /** 按当前配置关窗（渲染进程 → 主进程）。 */
  shortcutsCloseWindow: "dsh-desktop:shortcuts-close-window",
} as const;

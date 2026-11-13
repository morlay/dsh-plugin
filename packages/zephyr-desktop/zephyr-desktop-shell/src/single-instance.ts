// 第二个实例该做什么：**只聚焦已有窗口**，不装配第二份宿主。
//
// 起两个实例 = 两份宿主、两份 vite、同一个数据根（`shortcuts.json` 与宿主库会并发写）。锁本身由
// Electron 的 `requestSingleInstanceLock` 给，这里只裁决「拿到锁的那个窗口怎么被抬到前台」。
/** 能被聚焦的窗口（Electron `BrowserWindow` 的子集）。 */
export interface FocusTarget {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/** 聚焦结果：`none` 表示没有可用窗口（第二个实例照样退出）。 */
export type FocusOutcome = "focused" | "none";

/**
 * 把已有窗口抬到前台（最小化时先恢复——`focus()` 对最小化窗口无效）。
 * @param target - 当前窗口。
 * @returns 是否聚焦到了一个活着的窗口。
 */
export function focusWindowOf(target: FocusTarget | undefined): FocusOutcome {
  if (target === undefined || target.isDestroyed()) return "none";
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  return "focused";
}

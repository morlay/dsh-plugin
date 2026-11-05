// 页面侧的**外观标记**：纯函数，不碰 electron（preload 与测试都用它）。
//
// 无标题栏时，左侧栏要给 macOS 的红绿灯 / Windows 的窗口按钮让出顶部空间——前端按
// `<html data-platform data-titlebar>` 折叠那一段，而不是各写一份 `process.platform` 判断。
export interface DocumentMarkTarget {
  readonly documentElement?: {
    readonly dataset: Record<string, string | undefined>;
  };
}

/**
 * 把平台与标题栏形态标到 `<html data-*>` 上。
 * @param target - 文档（测试可注入）。
 * @param platform - 平台。
 * @param titlebar - 标题栏形态（缺省 `hidden`：桌面窗口都是无标题栏的）。
 */
export function markDocument(
  target: DocumentMarkTarget | undefined,
  platform: string,
  titlebar = "hidden",
): void {
  const root = target?.documentElement;
  if (root === undefined) return;
  root.dataset["platform"] = platform;
  root.dataset["titlebar"] = titlebar;
}

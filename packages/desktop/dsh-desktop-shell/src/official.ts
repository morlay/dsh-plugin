import { OFFICIAL_PROFILE_PACKAGES } from "./official-packages.generated.ts";

// 官方包清单是壳与工具共用的事实：工具侧（bundle 的依赖闭包、dev 的解析）按包名引这里。
export { OFFICIAL_PROFILE_PACKAGES };

/** 工具自带的桌面 host 变体包（不是上游 private 应用）：部署里按这个名字落位，壳按 `<pkg>/lib/index.js` 启动。 */
export const DESKTOP_HOST_PACKAGE = "@morlay/dsh-desktop-host";

export const OFFICIAL_RUNTIME_PACKAGES: readonly string[] = [
  "@deepseek-ai/dsh",
  DESKTOP_HOST_PACKAGE,
  ...OFFICIAL_PROFILE_PACKAGES,
];

export const OFFICIAL_PROFILE_BUNDLES: readonly string[] = [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
];

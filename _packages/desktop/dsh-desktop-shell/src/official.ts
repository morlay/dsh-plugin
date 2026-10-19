// 工具自带的桌面 host 变体包（不是上游 private 应用）：部署里按这个名字落位。
export const DESKTOP_HOST_PACKAGE = "@morlay/dsh-desktop-host";

// 官方那两个 bundle：`dsh.profile.bundles` 里属于"官方侧"的名单（app 自己声明的 bundle 按它分家）。
export const OFFICIAL_PROFILE_BUNDLES: readonly string[] = [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
];

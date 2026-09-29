// 设置命名空间 = host 装配行 id（`configForms.get(ns)` 按行 id 取 describe 段）。fork 行由
// `bundles/better-session` 的 patch 插入，id 与这里一致；官方 `ui-conversation` 行已停用，不能沿用上游常量。
export const FORK_SETTINGS_NAMESPACE = "ui-conversation-fork";

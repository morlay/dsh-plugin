# @morlay/dsh-client-ui-conversation

上游 `@deepseek-ai/dsh-client-ui-conversation` 的**薄壳 fork**（host 半 + client 半），一对一替换官方
`ui-conversation` 行：官方该行在装配里被禁用，槽声明、locale 与设置命名空间与我们保持同形。

## 用法

装配入口是聚合层 [`@morlay/better-session`](../../bundles/better-session/README.md)：它的 bundle patch 把官方
`ui-conversation` 行 `disabled: true` 并 insert 本包（行 id `ui-conversation-fork`）。薄壳只保留我们有意改过
的文件，其余上游文件由保留文件里的相对 import 指向
`vendor/deepseek-harness/packages/client/ui-conversation/src/...`，构建时内联进 `dist/client.cjs`（发布物自包
含）；开发态由 `dsh-desktopify` 的 `dev-client-bundles` 现场打包。

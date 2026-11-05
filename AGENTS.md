# AGENTS.md

## 必读

- 命令与版本：[`justfile`](./justfile)（`just --list`）· [`mise.toml`](./mise.toml)
- 记录树的布局与命名：[`.agents/README.md`](./.agents/README.md)
- 术语与上下文边界：[`.agents/GLOSSARY-MAP.md`](./.agents/GLOSSARY-MAP.md)
- 规范（如何写 / 如何验证）：本层 `.agents/standards/`
- 设计、决策与债：本层 `.agents/{designs,adrs,debts}/`

## 红线

- 上游 `@deepseek-ai/*` **不可修改**（`vendor/**` 与 node_modules 只读；扩展走 zephyr；本地 patch 是例外，见上游同步技能）。
- **发布走 CI**：严禁本地私自 `pnpm publish`（包括用 `--registry` 指向 GitHub Packages 的发布）。
  版本 bump 提交后由 CI 发布；本地只构建验证。

## 记录与 home

一个事实只有一个 home：写之前先找它现在在哪，**找到就改那一份**，找不到才新建；别处要用就链接过去。

| 你要写的事实                   | home                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 词是什么意思                   | 它被定义的那个包或层 `.agents/GLOSSARY.md`；定义权见 [`.agents/GLOSSARY-MAP.md`](./.agents/GLOSSARY-MAP.md) |
| 代码与包怎么写 / 怎么验证      | 改动所属层的 `.agents/standards/`                                                                           |
| 设计与取舍（跨包跨层或改边界） | 改动所属层的 `.agents/designs/`                                                                             |
| 难逆的决策与理由               | 同层 `.agents/adrs/`                                                                                        |
| 已知且被接受的债               | 同层 `.agents/debts/`                                                                                       |
| 包 / 应用的门面与用法          | 该包的 `README.md`                                                                                          |
| 规格、票据、实施笔记           | 临时产物目录（`.scratch/`，不进仓库）                                                                       |

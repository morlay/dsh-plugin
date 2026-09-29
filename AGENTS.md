# AGENTS.md

## 必读

- 命令与版本：[`justfile`](./justfile)（`just --list`）· [`mise.toml`](./mise.toml)
- 记录树的布局与命名：[`.agents/README.md`](./.agents/README.md)
- 术语与上下文边界：[`.agents/CONTEXT-MAP.md`](./.agents/CONTEXT-MAP.md)
- 规范（如何写 / 如何验证）：本层 `.agents/standards/`
- 设计、决策与债：本层 `.agents/{designs,adrs,debts}/`

## 一个事实只有一个 home

写之前先找它现在在哪：**找到就改那一份，找不到才新建**；别处要用就链接过去，不复制、不换说法。
**就近**：改动属于哪一层，就写那一层的 `.agents/`。

每类记录的**判据与格式**（含命名、引用写法、四份模板）的 home 是
[`dsh-plugin-design` 技能](./.agents/skills/dsh-plugin-design/SKILL.md)；这张表只回答「写到哪里」：

| 事实类型                  | home                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| 词是什么意思              | 该层 `.agents/CONTEXT.md`（边界见 [`.agents/CONTEXT-MAP.md`](./.agents/CONTEXT-MAP.md)） |
| 规范（如何写 / 如何验证） | 该层 [`.agents/standards/`](./.agents/standards)                                         |
| 设计与取舍                | 该层 `.agents/designs/`                                                                  |
| 难逆的决策与理由          | 该层 `.agents/adrs/`                                                                     |
| 已知且被接受的债          | 该层 `.agents/debts/`                                                                    |
| 包 / 应用的门面与用法     | 该包的 `README.md`（一句话定位 + 用法 + 链接）                                           |

## 红线

- 上游 `@deepseek-ai/*` **不可修改**（`vendor/**` 与 node_modules 只读；扩展走 cordis
  插件层：plugin / patch bundle / settings namespace；本地 patch 是例外，见
  `dsh-plugin-upstream-sync` 技能）。
- **发布走 CI**：严禁本地私自 `pnpm publish`（包括用 `--registry` 指向 GitHub Packages 的发布）。
  版本 bump 提交后由 CI 发布；本地只构建验证。

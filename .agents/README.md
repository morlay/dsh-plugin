# .agents/

按层组织的记录树。唯一规则：**改动属于哪一层，就写那一层的 `.agents/`。**

## 布局

| 目录 / 文件               | 每层都可       |
| ------------------------- | -------------- |
| `CONTEXT.md`              | 是             |
| `standards/`              | 是             |
| `designs/<YYYYMMDD>-*.md` | 是             |
| `adrs/<YYYYMMDD>-*.md`    | 是             |
| `debts/<YYYYMMDD>-*.md`   | 是             |
| `skills/`                 | **只在仓库根** |

每个目录放什么、判据是什么，见仓库根 [`AGENTS.md`](../AGENTS.md) 的 home 表；命名与格式见
`dsh-plugin-design` 技能的 `templates/`。

当前分层：

- 仓库根 [`.agents/`](./)：跨包 / 跨层的事实（会话编辑词汇、规范、系统设计、仓库级决策与债）+ 全部技能；
- 包层 `.agents/`：每层就地记录自己的术语、规范、设计、决策与债。

哪个上下文归属哪些包、术语表的 home 在哪，见 [`CONTEXT-MAP.md`](./CONTEXT-MAP.md)。

## 命名与引用

命名（`<YYYYMMDD>-<slug>.md`，无序号）与同层 / 跨层引用的**写法只有一个 home**：
[`dsh-plugin-design`](./skills/dsh-plugin-design/SKILL.md) 技能的「产出记到哪个 home」一节（`templates/`
只给格式骨架）。这里不复述，需要时链接过去。

## 规矩

- 判据、命名与格式的 home 是 `dsh-plugin-design` 技能（`templates/` 给骨架、SKILL.md 给判据与命名）；这里和别处都不复述。
- 「什么事实写哪个 home」的表在仓库根 [`AGENTS.md`](../AGENTS.md)。

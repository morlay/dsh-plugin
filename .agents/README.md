# .agents/

按层组织的记录树。唯一规则：**改动属于哪一层，就写那一层的 `.agents/`。**

## 布局

| 目录 / 文件               | 每层都可                                                      |
| ------------------------- | ------------------------------------------------------------- |
| `GLOSSARY.md`             | 是                                                            |
| `standards/`              | 是                                                            |
| `designs/<YYYYMMDD>-*.md` | 是                                                            |
| `adrs/<YYYYMMDD>-*.md`    | 是                                                            |
| `debts/<YYYYMMDD>-*.md`   | 是                                                            |
| `skills/`                 | **只在仓库根**（可自带 `templates/`、`references/` 与执行器） |

每个目录放什么、判据是什么，见仓库根 [`AGENTS.md`](../AGENTS.md) 的 home 表。

当前分层：

- 仓库根 [`.agents/`](./)：仓库级事实（[定义权地图](./GLOSSARY-MAP.md)、规范、[系统设计](./designs/20260917-系统设计.md)与各层设计入口、仓库级决策与债）+ 全部技能；
- 层 `.agents/`：每层就地记录自己的规范、设计、决策与债；
- 包 `.agents/`：定义者就地持有自己的术语（`GLOSSARY.md`）、规范、设计、决策与债。

技能由 harness 注入到上下文（`.agents/skills/<name>/SKILL.md` 的 frontmatter 就是清单），
这里不复述流程与技能内容。

## 命名与引用

命名（`<YYYYMMDD>-<slug>.md`，无序号）与同层 / 跨层引用的**写法只有一个 home**：
[`zephyr-design`](./skills/zephyr-design/SKILL.md) 技能的「产出落盘」一节（`templates/`
只给格式骨架）。这里不复述，需要时链接过去。

## 规矩

- 判据、命名与格式的 home 是 `zephyr-design` 技能；这里和别处都不复述。
- 「什么事实写哪个 home」的表在仓库根 [`AGENTS.md`](../AGENTS.md)。
- 记录只描述现状：不写演变、不写评审历史；历史由 git 保证。

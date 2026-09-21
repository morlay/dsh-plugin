# @morlay/dsh-context-tool-guidance

把工具用法按组切开、交给注入通道的 cordis 插件。**工具不设门控**：全部工具始终可见可调用；
组只决定用法说明怎么分批送达——`base` 组正文常驻，`flow` / `team` 注册成按需加载的 skill。

规则的 home 在 [上下文注入规则](../../.agents/designs/20260921-上下文注入规则.md)；本包只提供内容。

## 为什么

上游把每个工具的跨调用说明都注册成系统提示词 section（本部署实测占 9200 字符里的约 7400），
条数多、篇幅大、挤在上下文最前面稀释真正要遵守的纪律。这些说明既不该常驻，也不该丢掉——
所以按组切开：每组一份中文用法列表（上游说明的要点已吸收进来，原文丢弃），基础的常驻、其余的按需加载。

## 行为

| 环节     | 做什么                                                                                    |
| -------- | ----------------------------------------------------------------------------------------- |
| 装配     | 每组登记一个 `tool-group-<key>` skill；`base` 为 `auto`（正文随 reminder 常驻），其余按需 |
| 装配投影 | 用一行中文短描述覆盖模型看到的工具 `description`（压住常驻 schema 的开销）                |
| 丢弃     | 上游工具说明与规则 section 不再进提示词（`drops`），要点已写进各组的中文列表              |

- **短描述改装配投影，不写注册表**：在 agent 作用域注册同名工具会同步触发 `tools/change`，而上游
  `tool-subagent` 用该事件做 composition reconcile——两边互相触发会让装配风暴式重入（曾把 session 创建卡死）。
- **正文是中文列表**：一行一条直接讲怎么用（`lines`），**不拼上游原文**——否则同一件事中英各说一遍。
  上游说明的要点已经吸收进这些行里。

## 组

| key    | 中文名   | 注入方式 | 回收的上游说明                                                                  | 工具                                                                                                                         |
| ------ | -------- | -------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `base` | 基础     | `auto`   | read / write / edit / glob / grep / bash / pwsh / jobs / web_fetch / web_search | read / write / edit / glob / grep / bash（或 pwsh）/ ask_user_question / job_* / read_image / web_fetch / web_search / skill |
| `flow` | 流程     | 按需     | goal                                                                            | todo_write / exit_plan_mode / goal 三件套 / present                                                                          |
| `team` | 协作编排 | 按需     | subagent / subagent_fork / workflow / team:policy                               | 派发与协同全套（按实际装配渲染）                                                                                             |

组的唯一 home 是 [`src/groups.ts`](./src/groups.ts)：工具名、skill 摘要与正文（`lines`）、注入方式、
丢弃清单（`drops`）、短描述都在那一份里；覆盖性测试（[`upstream-inventory.spec.ts`](./src/__tests__/upstream-inventory.spec.ts)）
保证标准装配的每个工具与每个 section 都有归属。

## 装配

由 [dsh-preset](../../preset/dsh-preset/README.md) 的生成器写进 preset 产物末尾一行（无 config）。

# @morlay/dsh-context-assembler

提示词通道：**装配结果上的文本转换**（`replace` / `suppress`）与**降级 section 的按步送达**（本步没留在系统提示词
里的 section 改以 reminder 紧随用户消息送达，压缩后的重试再补投一次）。**不给扩展点**：没有注册面，也不接管任何
"面"——工作区指令与技能目录用官方行（`@deepseek-ai/dsh-agent-instructions` / `@deepseek-ai/dsh-tool-skill`）自己的
注入方式。按会话的工具收口与三个注入开关（`instructions` / 技能目录 / 动态快照）**不在本包**：收口的输入是模式定义、
唯一消费者也是模式，所以它住在 [`@morlay/dsh-session-mode`](../../profile/dsh-session-mode/README.md)。

## 用法

装配面只有一行：包根（`@morlay/dsh-context-assembler`）就是通道本体，config 是 `keep` / `suppress` / `replace` 的
缺省。行清单的真源是 [`src/rows.ts`](./src/rows.ts)（`contextChannel()`，经 `./rows` 出口供装配层引用），本部署把它
渲染进 [`@morlay/session-mode-profile`](../../bundles/session-mode-profile/cordis.patch.yml) 的 patch：

```yaml
- insert:
    - id: context-assembler
      name: "@morlay/dsh-context-assembler"
```

| 出口     | 行 id / 插件 name         | 做什么                                                                                                                           |
| -------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `.`      | `context-assembler`       | 通道本体：装配结果上的文本转换 + 降级 section 的按步送达，发布 `ctx.contextAssembler`；config 是 `keep` / `suppress` / `replace` |
| `./rows` | —（不是插件，只出那一行） | `contextChannel()`，装配层据此渲染 patch                                                                                         |

**通道全局一份、不隔离**：消费者（[`@morlay/dsh-tool-guidance` 的包根](../../profile/dsh-tool-guidance/README.md)，
以及把 `instructions` 开关拨过来的 `dsh-session-mode` 收口）住在别的包里，隔离会让它们解析不到服务（行停在 waiting，
不报错）。模式差异不在通道上表达：通道只认按 agent 推来的那一个开关（`setInstructions`），收口与模式定义都在
`@morlay/dsh-session-mode` 里。

工具说明（汉化精简 + 用法分组）不在这个包里：它归 [`@morlay/dsh-tool-guidance`](../../profile/dsh-tool-guidance/README.md)
（包根即运行时），对通道的依赖只剩 `suppressSection` 一处；引用展开也是独立包
[`@morlay/dsh-reference`](../dsh-reference/README.md)（它不依赖通道服务）。

规则与 id 见[设计 上下文注入规则](./.agents/designs/20260921-上下文注入规则.md)；本包留什么、三份默认清单的归属见
[设计 通道只做转换](./.agents/designs/20260929-通道只做转换.md)。

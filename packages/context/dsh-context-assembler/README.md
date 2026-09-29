# @morlay/dsh-context-assembler

提示词注入能力组：**一个包四个能力**，能力名就是子出口名。主出口是**组装插件**（按 config 决定装哪些能力、
各带什么参数，缺省四套），各能力另有子出口可单独装；每个能力都是独立的 cordis 插件（各自的 `apply` 与
`inject`）——合成单入口会让 `inject` 变并集，一个可选搭档缺席就拖垮整包。

## 用法

行清单的真源是 [`src/rows.ts`](./src/rows.ts)（`contextChannel()` / `scopeRow()`，经 `./rows` 出口供装配层
引用），本部署把它渲染进
[`@morlay/session-mode-profile`](../../bundles/session-mode-profile/cordis.patch.yml) 的 patch：

```yaml
- insert:
    - id: context-assembler
      name: "@morlay/dsh-context-assembler"
      config:
        capabilities: [assembler, agent-instructions, skill-catalog]

- insert:
    - id: context-assembler-scope
      name: "@morlay/dsh-context-assembler/scope"
```

| 出口                   | 行 id / 插件 name                                         | 做什么                                                                       |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `.`                    | `context-assembler`（插件 name `context-assembler-tree`） | **组装出口**：按 config 装哪些能力、各带什么参数（缺省即四套能力）           |
| `./assembler`          | `context-assembler`                                       | 注入通道：唯一渲染者与唯一覆盖判定处，发布 `ctx.contextAssembler`            |
| `./agent-instructions` | `context-agent-instructions`                              | 工作区指令链（`$DSH_HOME/AGENTS.md` + 项目根到 cwd 逐级）                    |
| `./skill-catalog`      | `context-skill-catalog`                                   | skill 目录规则块 + 模型侧 `skill` 工具                                       |
| `./scope`              | `context-assembler-scope`                                 | 按会话收口：工具白名单、instruction 总开关、动态快照开关（定义由模式推给它） |
| `./rows`               | —（不是插件，只出行清单）                                 | `contextChannel()` / `scopeRow()`，装配层据此渲染 patch                      |

两条硬要求：**通道全局一份、不隔离**——消费者（工具说明、skill 目录）住在别的包里，隔离会让它们解析不到服务
（行停在 waiting，不报错）；**装配期不按模式裁**——「这一面归谁」是会话级事实（工作区指令在 preset 自带上游
行时让位，skill 面由通道抢面）。

工具说明（汉化精简 + 用法分组）不在这个包里：它归
[`@morlay/dsh-agent-toolkit`](../../profile/dsh-agent-toolkit/README.md) 的 `guidance` 出口，`inject` 的是同一份
全局通道；本包只做上下文重排。引用展开也是独立包
[`@morlay/dsh-reference`](../dsh-reference/README.md)（它不依赖通道服务）。

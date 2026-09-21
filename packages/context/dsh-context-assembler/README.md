# @morlay/dsh-context-assembler

提示词注入的唯一通道：system prompt 里只留部署 persona 与覆盖规则，其余内容按调用方的声明决定怎么到达模型
——降级为规则块（`<system-reminder id="…">`）、回收进按需加载的 skill 正文、或直接丢弃。

规则、id 表与分层的 home 在 [上下文注入规则](../.agents/designs/20260921-上下文注入规则.md)；
术语见 [context 层的 CONTEXT.md](../.agents/CONTEXT.md)。

## 行为

### 装配结果上的三种处置

| 处置       | 谁决定                                       | 结果                                   |
| ---------- | -------------------------------------------- | -------------------------------------- |
| `keep`     | 配置（部署 persona + 覆盖规则声明）          | 留在系统提示词                         |
| `demote`   | 其余非空 section 的默认去处                  | 文本进规则块，**一条 section 一个 id** |
| `suppress` | 配置默认值（平台说明等）+ `suppressSection`  | 不进提示词                             |
| `replace`  | 配置默认值（两段中文文案）+ `replaceSection` | 换成给定文本；空串等于不注入           |

（**回收**不在这里：谁想把自己的内容收进 skill 正文，就自己写进那份正文——`tool-guidance` 的组正文与
`drops` 清单就是这么做的，通道不提供把 section 文本搬进正文的能力。）

### 注入

| 声明                          | 到达方式                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `registerSkill` + `on-demand` | 注册成模型可用 skill：目录一行摘要常驻，正文由 `skill` 工具加载                        |
| `registerSkill` + `auto`      | 正文随 reminder 常驻；skill 标 `modelInvocable: false`（用户仍可 `skill:<名字>` 引用） |

- **信封**：`<system-reminder id="…">`；id 里的引号转义，正文里的 `</system-reminder>` 写成
  `<\/system-reminder>`。
- **覆盖是语义的**：同 id 的最新一条取代更早的同 id 条目，不重写会话历史；规则由
  [`rules.ts`](./src/rules.ts) 在系统提示词里声明一次，所以每条 reminder 只带 id 与正文。
- **幂等键 = id**：同 id 最近一条文本未变就不注入；变了才追加一条。判定只认会话 surface——稳态、
  重启 / 恢复、rewind 截断后走同一条判定，截断即补发。
- **顺序**：同一步的多条按 id 字典序注入。
- **压缩后的首次请求**：早期 reminder 进摘要 checkpoint 后，重试请求不再经过 pre-step——插件以 `prepend`
  站在 `agent/request-error` 瀑布最外层，等压缩完成后按同一 surface 判定逐条补写。

## 调用面

```ts
ctx.contextAssembler.registerSkill({ name, title, description, content, requires?, injection? });
ctx.contextAssembler.replaceSection(sectionName, (agent) => text);
ctx.contextAssembler.suppressSection(sectionName);
```

skill 在装配期注册一次（正文与 agent 无关），对所有会话可见；注入（`auto` 正文与降级 section）按会话进行。

## 配置

| 字段       | 默认                                       | 含义                          |
| ---------- | ------------------------------------------ | ----------------------------- |
| `keep`     | 部署 persona + 覆盖规则 section            | 留在系统提示词里的 section 名 |
| `suppress` | 平台运维说明 + 本部署不装配的工具说明      | 不进提示词的 section 名       |
| `replace`  | 两段中文文案（`@` 引用语义、输出链接规范） | section 名 → 替换文本         |

默认值定义在 [`src/defaults.ts`](./src/defaults.ts)。

## 装配

作为 **host plane** 的部署级行装配一次：本部署在 [dsh-preset](../../preset/dsh-preset/cordis.patch.yml)
的 patch 里插入这一行（一行覆盖全部 preset）。

## 已知限制

- **reminder 仍是模型输入**：总 token 不减，只是不再占系统提示词的位置；真正省 token 的是「按需加载」
  那一半（正文不进上下文，直到模型加载）。
- **回收是注入方的事**：通道不把 section 文本搬进 skill 正文（`tool-guidance` 的组正文就是各组自己
  写好的要点，配套 `drops` 清单决定哪些上游说明不再进提示词），所以 `auto` 正文在注册时即完整。
- **顺序**：reminder 与工作区指令都是 pre-step 注入的 user 消息，两者先后由 listener 注册顺序决定。

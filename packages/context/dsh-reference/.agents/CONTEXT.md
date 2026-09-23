# 引用展开

`packages/context/dsh-reference/` 的词：把用户消息里的引用手势变成注入内容这一件事。信封形态与
「内容块」的定义在注入通道那边（[注入能力组的术语表](../../dsh-context-assembler/.agents/CONTEXT.md)），
这里只用、不重定义。

## 术语

**引用手势**：
用户**手打**的 `@path` / `skill:name`（或经引用选择器 pick）。只有手势才触发展开——`file:` 协议与
`[label](x)` 的官方语义是链接，不是「给我内容」。

**展开**：
在 `agent/pre-step` 按手势读出内容、合成一条注入消息（文件内容 + 一条中文 `<system-reminder>` 说明），
追加在本步消息之后。读不出（文件不存在 / 无 `ctx.fs` / 无对应工具）就不是展开，引用原样留在文本里。

**窗口**：
文件引用读出来的行范围与上限：`@a.ts:12`、`@a.ts#L12-L40` 等写法归一到
`{ path, lineStart, lineEnd, column }`，上限取 `read` 的默认值——同一条引用在 `read` 与展开两条路上看到
同一个窗口。

**引用解析**：
把引用文本归一成结构化引用的那一步（`findReferences` / `parseReferenceToken` /
`formatReferenceMention`）。它的 home 是
[`@morlay/dsh-client-ui-primitives`](../../../client/ui-primitives/src/reference.ts)（client 与 host 共用一份），
本包构建时内联。

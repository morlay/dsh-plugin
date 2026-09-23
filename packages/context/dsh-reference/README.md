# @morlay/dsh-reference

**引用展开**：用户消息里手打的 `@path` / `skill:name` 引用在 `agent/pre-step` 展开成注入内容——文件走
`<file_content>` 内容块（窗口与 `read` 一致）、skill 走正文与 `skill` 工具；读不出的引用静默保持普通文本。

它不依赖注入通道（[`@morlay/dsh-context-assembler`](../dsh-context-assembler/README.md) 的
`ctx.contextAssembler`）：自己挂 `agent/pre-step`、`inject` 只有 `skills`，所以在 preset 的通道组之外
装配也成立。装配落在 [`@morlay/better-session`](../../session/better-session/cordis.patch.yml)（一行
`@morlay/dsh-reference`）。

## 用法

装配一行即可，没有 config：

```yaml
- id: reference
  name: "@morlay/dsh-reference"
```

引用解析（`@a.ts`、`@a.ts#L12-L40`、`@[label](a.ts)`、`skill:name` 等形态与行窗口）复用
`@morlay/dsh-client-ui-primitives` 的 `reference.ts`——**源码上唯一一份**，构建时内联进本包产物，
所以发布清单里没有它。

## 文档

- 设计与取舍（窗口、信封、读不出的处理）：[设计 文件引用内容注入](./.agents/designs/20260920-文件引用内容注入.md)
- 信封形态（`<file_content>` 由谁定）：[设计 上下文注入规则](../dsh-context-assembler/.agents/designs/20260921-上下文注入规则.md)
- 本包术语：[.agents/CONTEXT.md](./.agents/CONTEXT.md)

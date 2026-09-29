# 如何写（薄壳 fork 包）

`@morlay/dsh-client-ui-conversation` 是上游 `@deepseek-ai/dsh-client-ui-conversation` 的**薄壳 fork**：只留
我们有意改过的文件，其余靠相对 import 引上游源码，于是**上游 client 半源码进了同一个 TS program**。下面几条
是这件事的硬约束，改这个包或加同类包时都成立。

## 形态

- **只留有意改过的文件**（保留清单在
  [债务 20260917-临时接管上游对话UI的client半](../debts/20260917-临时接管上游对话UI的client半.md) 的「保留
  文件」表）；不再复制的上游文件由保留文件里**相对路径**的 import 指向
  `vendor/deepseek-harness/packages/client/ui-conversation/src/...`（上游文件内部的相对 import 不动，闭包在
  vendor 内自解析）。
- 指向上游的那部分由 tsdown 构建期内联进 `dist/client.cjs`（发布物自包含）；开发态由 `dev-client-bundles` 现场
  打包（上游组件的 `.module.css` 一并内联）。

## tsconfig

- **根 `tsconfig.json` 必须保持 `composite: false`**：composite 要求列全文件，而 vendor 源被 import 进来、
  又在 `exclude` 里 → `TS6307`。
- **不给这个包加包级 tsconfig**：dts 阶段按 tsconfig 推 `rootDir`，包级 tsconfig 会把 vendor 源推到
  `rootDir` 之外。

## 类型面

- **合并接口（`SlotMap` / `Context` / `Events` / `LocaleNamespaceMap`）只能有一份实例**：不在我们这边重复
  声明（结构相同也算不同实例 → `TS2717`）——`contract/slots.ts` 因此不保留，上游那份即唯一实例。
- **扩宽用「本地接口 extends 上游那份」**（`client/contract/input.ts` 的 `restoreDraft`）；确需断言时按
  运行期事实收窄一次并注明理由。
- **`Context.input` 的收窄与官方类型不可共存**：`client/index.ts` 在 `declare module "@deepseek-ai/cordis"`
  里把 `conversation` 收窄成 `Omit<IConversation, "input"> & { input: SessionInputResolver }`
  （`ui-conversation-message-actions` 靠它改写草稿）。模块增强表达不了「属性类型收窄」：官方
  `@deepseek-ai/dsh-client-ui-conversation` 的类型一旦与这段声明同处一个 program，TS 就按「同一属性的两次
  声明类型不同」报 `TS2717`（`conversation` 一条；`uiConversation` 一条是「同名类型两份实例」）。运行期官方
  `ui-conversation` 行是 disabled 的、同一 scope 里只有 fork 这一份服务，所以冲突只在类型层。
  - **后果**：任何把官方 `ui-conversation` 类型拉进同一 program 的东西都会让 `just lint` 变红——包括上游
    0.1.7 起提供的 client 测试 harness（`@deepseek-ai/dsh-client-test-runtime` 的 `SlotTestRuntime`，vendor 的
    `packages/test-support/client-runtime/`：它的 `fixtures.ts` 引官方包类型），所以装配面的行为用例还开不了
    （[债务 20260917-对话UI客户端半的装配面缺测试辅助](../../../ui-conversation-message-actions/.agents/debts/20260917-对话UI客户端半的装配面缺测试辅助.md)）；
    接线改由 [`src/__tests__/upstream-wiring.spec.ts`](../../src/__tests__/upstream-wiring.spec.ts) 守。
  - **不要重试的两条路**：把声明搬进 `.d.ts` 靠 `skipLibCheck` 覆盖（tsgolint 不把 `/// <reference>` 或
    `import type {} from "./x.d.ts"` 指到的声明文件纳入 program → 收窄直接失效）；就地加 `@ts-ignore`（报错压
    住的同时收窄类型失效）。
  - 真要开装配面行为用例，得先把收窄从「占用官方属性名」改成 fork 自己的服务 / 类型面（契约变更，落 ADR）。

## 槽覆盖只走 list 槽按 id shadow

keyed 格子的 `children` 既是子槽声明也是 `renderSlot` 授权：官方 `conversation.chat.node` 的 key `turn-tail`
那一格已声明 `conversation.chat.turnTail` / `conversation.chat.assistant-actions`（消费者 `ui-deliverables` /
`ui-plan` / `ui-message-feedback`）。同 key、同优先级再注册即 fail loud：

```text
slot "conversation.chat.turnTail" is already declared (by an entry in "conversation.chat.node")
```

带 `children` 覆盖撞「already declared」，不带 `children` 覆盖则丢这两个槽的全部贡献。因此这一格只能沿用官方
实现；可用的覆盖面是 **list 槽按 id shadow**——编排层在 `conversation.composer.dock` 的 id `stats`
（priority −1）上覆盖官方同 id 行，就是这样承载它自己的统计行的。

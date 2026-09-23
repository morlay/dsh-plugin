# 如何验证（薄壳 fork 包）

通用规则（证据矩阵、jsdom pragma、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的落点与判据。

**保留的那部分由我们维护，就要按接缝测**——不能以「上游代码」为由留空白（保留清单与回退条件见
[债务 临时接管上游对话UI的client半](../debts/20260917-临时接管上游对话UI的client半.md)）。

## 保留文件的接缝

- **核心纯逻辑**（引用文本与 scoped slash 归一）→ node 环境单测：`src/__tests__/reference-text.spec.ts`。
- **输入 / 队列的组装面**（hub、输入外壳、队列行——依赖 DOM 事件与渲染）→ jsdom 组件测试：
  `src/__tests__/input-hub.spec.tsx`、`input-shell.spec.tsx`、`queue-dock.spec.tsx`。队列行的呈现面已回上游，
  这里守的是上游口径 + 本包唯一偏离「编辑 = 撤回」。
- **编辑器草稿层**（输入框保留 raw markdown：草稿文本不做引用装饰）→ jsdom 测试：
  `src/__tests__/editor-runtime.spec.tsx`（直接构造 `DraftEditorRuntime`，粘贴后断言 DOM 无
  `data-composer-text-ref`、投影文本原样）。
- **`apply` 的接线**（对 slots / locale / configForms 这些外部面的订阅）→ node 测试：
  `src/__tests__/upstream-wiring.spec.ts`，比对上游 `apply.ts` 与 fork 那份的订阅面（上游挂的订阅 fork 一条
  不少）。它守的是**同步纪律**：漏跟随上游接线不会报错、只会静默少刷新（0.1.7 漏
  `ctx.configForms.developerTools.enabled.subscribe` 就是这类）。语义对不对仍要人读上游那份，不替代行为
  用例。
- **不单独测**：locale 数据表、纯类型与桶文件、**不再复制的上游文件**（它们就是上游实现）——上游 `InputBar`、
  `QueueDock` 的呈现与样式都属这一类（上游自己的 client 测试覆盖），本包的 `.styles.ts` 也已全部回退，只剩
  `client/apply.ts` 的注册接线。

## 未覆盖（有明确原因）

- `client/apply.ts`（插件装配 + slots 注册）的**行为**、`client/skeleton/*`（`ConversationRoot` /
  `ConversationSession` / `InputBar` 等）、`client/service.ts`（`ConversationController`）的
  **slot 装配面**需要 cordis client 运行时（slots 声明者 / 注册表、locale、renderer、sessions 面），
  而上游 client 半是浏览器模块工厂，node / jsdom 不可加载。上游 0.1.7 起有可用的 client harness
  （`@deepseek-ai/dsh-client-test-runtime` 的 `SlotTestRuntime`，本包已试通），但它会把官方 ui-conversation
  的类型拉进同一个 program、与 fork 的收窄声明撞 TS2717——见[债务 临时接管上游对话UI的client半](../debts/20260917-临时接管上游对话UI的client半.md)
  的「已知冲突」，以及
  [债务 对话UI客户端半的装配面缺测试辅助](../../../ui-conversation-message-actions/.agents/debts/20260917-对话UI客户端半的装配面缺测试辅助.md)。
  动这些 `apply` / 装配面之前先看后者的触发条件。（只有「插进哪个槽、注册什么优先级、跟着哪个外部面重算」这类
  装配行为才需要 harness；组件的呈现面已回上游，不再需要本地用例。）

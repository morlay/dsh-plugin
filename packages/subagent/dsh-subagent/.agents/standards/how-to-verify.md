# 如何验证（薄壳 fork：host 半接管一行 + 设置页 client 半）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
写法约束见 [`session/ui-conversation` 的 how-to-write](../../../../session/ui-conversation/.agents/standards/how-to-write.md)
（薄壳 fork 的 tsconfig / 合并接口硬约束，本包同样适用）。这里只写本包的落点与判据。

本包 host 半的行为只有一条（回报指引是中文），但**同步纪律**是它的第二半：四个测试文件分别盯一件事；
client 半（设置页那张限额卡）另有自己的两个落点。

| 文件                                      | 接缝                                                     | 守什么                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/continuation-messages.spec.ts` | `withContinuableReturnGuidance`（纯函数）                | 文案要点齐全（父 id 插值、`send_message`、回报不结束回合），且不含上游英文                                                         |
| `__tests__/return-guidance.spec.ts`       | 运行期装配（`ctx.subagents.startContinuable`）           | **模型可见的请求**里是中文、没有英文——唯一的行为证据                                                                               |
| `__tests__/upstream-wiring.spec.ts`       | 保留文件本身                                             | 接线归一后与上游逐行一致；偏离只允许声明块 / 接线 / 该函数体；相对 import 都指向真实文件                                           |
| `__tests__/assembly.spec.ts`              | 两份 manifest + `cordis.patch.yml`                       | host 半三条行（禁用 ×3 / 本包行插入）、client 面的 `dsh.client` 与 `./client` 入口、卡片读的 namespace 是行 id                     |
| `__tests__/client-limits-card.spec.ts`    | 限额卡控制器（假 `SettingsFormScope` + fork 的表单模型） | 输入只改草稿、非法草稿挡保存、保存按 staged 顺序发 path op 并带 revision 栅栏、host 拒绝保留草稿、丢弃不发写、unavailable 时不可用 |

运行期那条用最小装配：`mountAgentLoopTestDependencies` + JSONL 持久化 + `AgentLoop` + 本包 `SubagentRuntime`

- `subagent-spawn-in-process` + **上游 `tool-subagent-control`**（它给 `send_message` 打内部标记，才触发
  指引追加），断言 `MockAdapter.requests` 里的可见文本。

**测试要跑得起来的前提**（改这几处会一起红）：

- vitest 侧：`vitest.config.ts` 的 `dsh-subagent-standard-decorators` 预转换（标准装饰器降级，见
  [根债务](../../../../../.agents/debts/20260923-vitest与构建需自行降级标准装饰器.md)）；
- 构建侧：`tsdown.config.ts` 的同名预转换（否则 `dist` 里的装饰器在 Node 上直接语法错）。
- client 半：限额卡用的表单原语是 fork 的 `@morlay/dsh-client-ui-primitives/client`（`SettingsForm` /
  `SettingsValueField` / `SettingsFormModel` / `settingsNumberField`）——它没落地或导出改名时，
  `client-limits-card.spec.ts` 会直接红在 import 上（不是断言失败）。

## 未覆盖（有明确原因）

- **卡片组件渲染面**（`src/client/SubagentLimitsCard.tsx` 画了什么）与 **`src/client/index.ts` 的装配面**
  （`slots` / `locale` / `configForms` 的注册、`plugins.row.config` 条目的 key）没有用例：它们要真的
  client 运行时（renderer 的 slot 注册表 + locale + jsdom），本仓库还没有这套 harness——见既有债务
  [对话 UI 客户端半的装配面缺测试辅助](../../../../session/ui-conversation-message-actions/.agents/debts/20260917-对话UI客户端半的装配面缺测试辅助.md)。
  眼下只有构建（`dist/client.cjs` 出得来）与 `assembly.spec.ts` 的 manifest 断言兜住「入口面声明」这一半。
- **上游文件的行为**（`child-agent.ts` / `continuation-activation.ts` 等未复制的那部分）由上游自己的测试覆盖，
  本包只在接线层面保证它们仍是同一份实现。
- **typert 远程面**（`./typert` / `./remote` 子路径仍来自上游包）没有本包用例：这些生成物按服务名与方法面
  匹配，本包类与上游同形；真出问题会在装配期（远程调用）暴露，而不是靠本地断言能测出来。
- **`subagent` / `subagent_fork` 派发工具的端到端语义**归上游 `tool-subagent` 与它的测试，本包不改它们。

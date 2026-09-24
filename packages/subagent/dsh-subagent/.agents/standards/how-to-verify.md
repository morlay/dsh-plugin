# 如何验证（薄壳 fork：host 半接管一行 + client 半只给字段文案）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
写法约束见 [`session/ui-conversation` 的 how-to-write](../../../../session/ui-conversation/.agents/standards/how-to-write.md)
（薄壳 fork 的 tsconfig / 合并接口硬约束，本包同样适用）。这里只写本包的落点与判据。

本包 host 半的行为只有一条（回报指引是中文），但**同步纪律**是它的第二半；client 半只注册字段文案，
自己有一个落点。

| 文件                                      | 接缝                                           | 守什么                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/continuation-messages.spec.ts` | `withContinuableReturnGuidance`（纯函数）      | 文案要点齐全（父 id 插值、`send_message`、回报不结束回合），且不含上游英文                                                                      |
| `__tests__/return-guidance.spec.ts`       | 运行期装配（`ctx.subagents.startContinuable`） | **模型可见的请求**里是中文、没有英文——唯一的行为证据                                                                                            |
| `__tests__/upstream-wiring.spec.ts`       | 保留文件本身                                   | 接线归一后与上游逐行一致；偏离只允许声明块 / 接线 / 该函数体；相对 import 都指向真实文件                                                        |
| `__tests__/assembly.spec.ts`              | 两份 manifest + `cordis.patch.yml`             | host 半三条行（禁用 ×3 / 本包行插入）；**没有** client 半（无 `./client` 出口与 `dsh.client`）；两个限额字段仍是 volatile——自动生成配置页的前提 |

运行期那条用最小装配：`mountAgentLoopTestDependencies` + JSONL 持久化 + `AgentLoop` + 本包 `SubagentRuntime`

- `subagent-spawn-in-process` + **上游 `tool-subagent-control`**（它给 `send_message` 打内部标记，才触发
  指引追加），断言 `MockAdapter.requests` 里的可见文本。

**测试要跑得起来的前提**（改这几处会一起红）：

- vitest 侧：`vitest.config.ts` 的 `dsh-subagent-standard-decorators` 预转换（标准装饰器降级，见
  [根债务](../../../../../.agents/debts/20260923-vitest与构建需自行降级标准装饰器.md)）；
- 构建侧：`tsdown.config.ts` 的同名预转换（否则 `dist` 里的装饰器在 Node 上直接语法错）。
- 配置页：`assembly.spec.ts` 断言两个字段仍是 `.volatile()`——去掉标注，页面就会在装配后消失（那种回归
  只有人工看页面才发现，所以用 manifest 层断言兜住声明面）。字段文案走 client 半的字段槽，`Config` 与上游
  逐行一致的守护（`upstream-wiring.spec.ts`）因此仍然成立。

## 未覆盖（有明确原因）

- **自动生成的页面本身**（渲染出什么控件、能不能存）由通用面
  [`client/ui-schema-form`](../../../../client/ui-schema-form/.agents/standards/how-to-verify.md)的用例覆盖；
  本包只保证「字段是 volatile + 行被插上 + 文案被认领」这三条前提。
- **上游文件的行为**（`child-agent.ts` / `continuation-activation.ts` 等未复制的那部分）由上游自己的测试覆盖，
  本包只在接线层面保证它们仍是同一份实现。
- **typert 远程面**（`./typert` / `./remote` 子路径仍来自上游包）没有本包用例：这些生成物按服务名与方法面
  匹配，本包类与上游同形；真出问题会在装配期（远程调用）暴露，而不是靠本地断言能测出来。
- **`subagent` / `subagent_fork` 派发工具的端到端语义**归上游 `tool-subagent` 与它的测试，本包不改它们。

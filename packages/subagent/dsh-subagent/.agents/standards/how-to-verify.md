# 如何验证（薄壳 fork：按官方行 id 接管一行，只改文案）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
薄壳 fork 的硬约束（本包同样适用）：根 `tsconfig.json` 保持 `composite: false`（vendor 源被 import 又在
exclude 里）、不给本包加包级 tsconfig（dts 阶段的 `rootDir` 会把 vendor 源推出去）、合并接口
（`Context` / `Events` 等）只能有一份实例（结构相同也算不同实例 → `TS2717`）。这里只写本包的落点与判据。

本包的行为只有一条（两处模型面向文案是中文、回报指引按会话选——默认不限 preset），**同步纪律**是它的第二半。

| 文件                                      | 接缝                                          | 守什么                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/continuation-messages.spec.ts` | `withContinuableReturnGuidance`（纯函数）     | 文案要点齐全（父 id 插值、`send_message`、回报不结束回合），且不含上游英文                                                                                  |
| `__tests__/return-guidance.spec.ts`       | 运行期装配（`ctx.subagents.startActivation`） | **模型可见的请求**里是中文、没有英文——唯一的行为证据；判定的两个方向都覆盖（不配名单 = 官方四个 shipped preset 也用中文；配了名单 = 名单外走上游英文）      |
| `__tests__/delegation-context.spec.ts`    | 运行期装配（真子代理 + 真 `assemble`）        | 子代理的 `subagent:delegation` 是中文、没有上游英文原文；本地两条派发（`delivery` 为 `parent` / `caller`）都覆盖，父 agent 的装配不出现这条                 |
| `__tests__/upstream-wiring.spec.ts`       | 保留文件本身                                  | 接线归一后与上游逐行一致；偏离只允许 `DELTAS` 表登记的那几条（新增块 / 接线 / 该函数体）；相对 import 都指向真实文件                                        |
| `__tests__/assembly.spec.ts`              | 装配入口与两份 manifest                       | 装配入口是 `@morlay/session-mode-profile`（app 列它、它依赖本包）；本包不发布 client 面（无 `./client` 出口、无 `dsh` 注入声明）；两个限额字段仍是 volatile |

运行期那条用最小装配：`mountAgentLoopTestDependencies` + `mountWorkingDirectoryFixture`（上游服务
`static inject = ['workingDirectory']`，不挂就不发布服务）+ JSONL 持久化 + `AgentLoop` + 本包 `SubagentRuntime` +
`subagent-spawn-in-process` + **上游 `tool-subagent-control`**（它给 `send_message` 打内部标记，才触发指引追加），
断言 `MockAdapter.requests` 里的可见文本。

**测试要跑得起来的前提**（改这几处会一起红）：

- vitest 侧：根 `vitest.config.ts` 的 `standardDecoratorsPlugin`（范围 `/packages/subagent/`，标准装饰器降级，见
  [根债务](../../../../../.agents/debts/20260923-标准装饰器降级分居两套机制.md)）；
- 构建侧：本包 `tsdown.config.ts` 的同名预转换（否则 `dist` 里的装饰器在 Node 上直接语法错）。
- 配置页：`assembly.spec.ts` 断言两个限额字段仍是 `.volatile()`——去掉标注，官方卡片就会在装配后画不出可改的限额；
  这类回归只有人工看页面才发现，所以用 manifest 层断言兜住声明面。

## 未覆盖（有明确原因）

- **官方设置卡页面本身**（渲染出什么控件、能不能存）归上游那两行与通用面
  [`client/ui-primitives`](../../../../client/ui-primitives/.agents/standards/how-to-verify.md)的用例；本包只保证
  「两个限额字段是 volatile + 装配行按官方 id 复用 + 文案被认领」这三条前提。
- **上游文件的行为**（`child-agent.ts` / `activation.ts` 等未复制的那部分）由上游自己的测试覆盖，本包只在
  接线层面保证它们仍是同一份实现；`subagent:delegation` 那条文本由本包在装配期改写，所以它的判据在本包（见上表）。
- **typert 远程面**（`./typert` / `./remote` 子路径仍来自上游包）没有本包用例：这些生成物按服务名与方法面匹配，本包
  类与上游同形；真出问题会在装配期（远程调用）暴露，而不是靠本地断言能测出来。
- **`subagent` / `subagent_fork` 派发工具的端到端语义**归上游 `tool-subagent` 与它的测试，本包不改它们。

# 测试支撑（testkit）的分层

状态：已收敛——base 只剩一处装配入口；扩展按需组合；**造数据的 fixtures 走各域的 `./testing`**。
范围：`packages/agent-ex/better-session` 的测试支撑（`src/__tests__/support/**`）与它被谁组合。
约束：上游 `@deepseek-ai/dsh-agent-loop-testkit` 能覆盖的一律不重写；`vendor/**` 只读。

## 一条规则：base 唯一，扩展按需组合，fixtures 归域

| 层                   | 内容                                                                                                                                                                                                                                                                                      | 判据                                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **域的 `./testing`** | 造数据的 fixtures、契约套件、最小装配 helper                                                                                                                                                                                                                                              | 同一份 fixture 在仓库里**只有一处**：会话域 `@morlay/dsh-session/testing`（`createSessionContext` / 造日志 / `runCoordinatorContract`）、落盘 `@morlay/dsh-session-persistence/testing`（`runPersistenceContract`）、工作区 `@morlay/dsh-workspace/testing`、DSL `@morlay/zephyr/testing`（注入占位与令牌元数据） |
| **base**             | `src/__tests__/support/base.ts`：`mountRows(rows, { dataDir, ctx, config, before })`——造 ctx、回填注入、绑事件字段、按派生名 + 上游别名发布、跑 `onInit`、返回 `get` / `tryGet` / `dispose`；`publish` / `publishToken` / `createCtx` / `FakeAppEnv` / 本包的行清单 `mountOnto` / `mount` | 全 `support/` 只有一处建 cordis ctx（转发会话域的 `createSessionContext`），没有 `bootstrapApplication`                                                                                                                                                                                                           |
| **扩展**             | 只做一件事，组合 base 或域的 `./testing`：整包装配（`host.ts`）、真 wire + 真 RDB 的宿主（`e2e-host.ts`）、浏览器半的 store + 端点客户端（`e2e-client.ts`）、DOM 渲染（`e2e-render.tsx`）、等待（`wait.ts`）、sqlite 同步句柄（`sqlite.ts`）                                              | 每个文件不自己起装配，也不再自己造会话日志                                                                                                                                                                                                                                                                        |

谁能用谁：扩展 → base → 域 `./testing`，单向。扩展之间不互相 import；要共用就下沉到 base 或域 `./testing`。

## 现状

| 文件             | 定位                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base.ts`        | **base**：`FakeAppEnv`（`AppEnv` 契约的替身，路径全指临时目录）、`createCtx`（转发 `createSessionContext`）、`mountRows`、`publish` / `publishToken`（派生名 + 上游别名双发）、`mountOnto` / `mount`（本包的行清单） |
| `host.ts`        | 整包宿主面的清单一处：`startHarness` / `startHarnessWithAgent` / `startAt` / `makeRoot` / `removeRoot`                                                                                                               |
| `e2e-host.ts`    | 全链路宿主：真 wire + 真 RDB + 端点 / 编辑行 + `AgentDirectoryStub`（`MOCK_REPLY_PREFIX`）                                                                                                                           |
| `e2e-client.ts`  | 浏览器半：真 store + 真端点客户端 + `ComposerStub`                                                                                                                                                                   |
| `e2e-render.tsx` | DOM 渲染：只依赖 DOM 与字典（`nodeOf` / `renderUserMessage`）                                                                                                                                                        |
| `wait.ts`        | 等待（纯函数 `waitFor`）                                                                                                                                                                                             |
| `sqlite.ts`      | sqlite 的同步句柄（造损坏数据 / 读 `PRAGMA`）                                                                                                                                                                        |

## 上游已有的 base 不要重写

- `@deepseek-ai/dsh-agent-loop-testkit`：`mountAgentLoopTestDependencies`（真 AgentLoop + 真 store / projection / tools / fs / executor）、`createInboxStub`、`unsupportedModel`、`provideWorkingDirectoryFixture`。它要求**真 cordis ctx**，调用方保留 ctx / agent / teardown 的所有权。
- 注意：`@deepseek-ai/dsh-agent` 没有 `./testing` 出口；「agent 的测试支撑」就在 `agent-loop-testkit` 这个包里。
- 本包手写件里没有 inbox / model 替身；要自写的只有两件，且都是 `vendor/**` 不进 TS program 的补偿：① `MountedContext` 的 `get` / `provide` 形态；② 上游名别名发布（装配器的别名机制在测试装配里同样要成立，否则「只发派生名」的 bug 在测试里抓不到）。

## 判据（怎么改才叫完成）

1. **装配入口只剩一个**：`mountRows`。`host.ts` / `e2e-host.ts` / `e2e-client.ts` / `mountOnto` 都是它的薄封装，自己不再出现 `bootstrapApplication` 或 `new Context`；造 ctx 本身走会话域的 `createSessionContext`。
2. **造数据只有一个 home**：`meta` / `userMessage` / `assistantMessage` / `turnLog` / `oneTurnLog` / `twoTurnLog` 这类 fixture 只在 `packages/agent/dsh-session/src/testing/**`；下游要新的形状就补域的 `./testing`，不在 spec 里现造。
3. **契约套件不内联装配**：`runPersistenceContract(name, make)` 与 `runCoordinatorContract(name, makeFixture)` 都收调用方给的装配回调；套件只描述「装配好之后的行为」。
4. **搬迁不丢判据**：改支撑后整包 `pnpm exec vitest run packages/agent-ex/better-session` 仍是 38 文件 / 377 通过。

## 两份「一个闭合回合」是有意并存的

`oneTurnLog()`（user/message 在 step/start 之前，手写六条）与 `oneTurnLogStepFirst()`（`turnLog(0, 1)` 派生）**不许合并**：落盘契约与 rdb 系按事件顺序断言，端点那一侧用 seq 2 = user/message 定位一条用户消息。合并任一份都要动既有断言，所以是两个名字，调用方按自己原来那一份取。

## 已知债

- `branch.spec.ts` 里还有一个**本地的** `twoTurnLog()`（由 `oneTurnLog()` 派生、消息在前），与域里的 `twoTurnLog()`（`turnLog` 派生、step 在前）同名不同形；重命名或收进域里都会动这一个 spec，留待下一批。
- `src/ui/**` 的三个 spec（`conversation-manager.controller.spec.ts`、`session-editor.store.spec.ts`、`ui.provide.spec.ts`）仍自己 `bootstrapApplication`（浏览器半的装配）；`host.ts` 的 `startHarnessWithAgent()` 也走它——上游 agent-loop testkit 要求一次真 `bootstrapApplication`。这两处是 `mountRows` 之外的装配入口，收拢它们要连上游 testkit 一起动。

## 目录边界（谁放哪）

| 测试类型                                             | 位置                                                     | 例子                                                         |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| 包 root 的底层逻辑（持久化、分支、查询、端点、契约） | `src/__tests__/*.spec.ts`                                | `rdb.spec.ts`、`branch.spec.ts`、`endpoint.spec.ts`          |
| 带 UI 的（渲染、消息动作、管理页、全链路）           | `src/ui/**/__tests__/*.spec.ts(x)`，与被测模块**同目录** | `src/ui/session-editor/__tests__/user-message.view.spec.tsx` |
| 支撑                                                 | `src/__tests__/support/**`（base + 扩展）                | 见上表                                                       |

`vitest.config.ts` 的 `include` 两条来源：`**/__tests__/*.spec.ts(x)` 与 `**/src/ui/**/*.spec.ts(x)`。不为全链路单独建一层集中目录——它属于「带 UI 的」那一行，跟被测模块同目录。

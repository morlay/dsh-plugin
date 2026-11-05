# 如何验证

本层的接缝是三个出口（`. ` / `./compat` / `./testing`）与装配内核；测试全部按包名或相对路径 import，
等于顺带守住出口形态。出口形状（不按运行环境分面、内核与 DSL 同在一个入口、适配面不在包根）由
`src/__tests__/entry-shape.spec.ts` 钉住，取舍见[包出口设计](../designs/20261113-包出口.md)。

## 证据矩阵

| 改动                                  | 至少跑                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 令牌 / 注入 / 清单 / 装配内核         | `pnpm exec vitest run packages/zephyr/zephyr`（从仓库根）                                                                              |
| 上游适配（`fromCordis` / `toCordis`） | 同上（`src/compat/__tests__/`）+ 一个真实适配行的包（`pnpm exec vitest run packages/agent/dsh-session`）                               |
| 编译期检查（`coverage.ts`）           | `just lint`（oxlint 的 type-aware 规则）+ 带 `@ts-expect-error` 的用例（`assembly.spec.ts`「缺依赖…」那条）；仓库没有独立的 `tsc` 任务 |
| 出口 / 依赖面                         | `just audit`（面边界、声明未用依赖）+ `just build`（三个出口真的出产物）+ `entry-shape.spec.ts`                                        |

## 判据落点

| 接缝                           | 判据                                                            | spec                                          |
| ------------------------------ | --------------------------------------------------------------- | --------------------------------------------- |
| `bootstrapApplication` / `App` | 注入回填、依赖序、预检、卸载顺序、诊断快照、别名                | `src/__tests__/assembly.spec.ts`              |
| `inject.optional` 的依赖序     | 可选注入也排在提供者之后（否则拿到适配行空壳）                  | `src/__tests__/optional-inject-order.spec.ts` |
| `EventEmitter`                 | 参数表逐事件独立、退订、未装配即抛、参数不符编不过              | `src/__tests__/event-emitter.spec.ts`         |
| `fromCordis` / `mount`         | 契约面来源、deps 读取替换、配置三层、`Service` 子类、忘 `mount` | `src/compat/__tests__/from-cordis.spec.ts`    |
| `toCordis`                     | 插件对象形状、`Config` 默认值、`onDispose`                      | `src/compat/__tests__/to-cordis.spec.ts`      |

## 两条纪律

- **编译期判据用 `@ts-expect-error` 钉住**，不要用 `as never` 抹掉：错误真消失时它会报「未使用的 expect-error」。
- **新契约要有一条跨包证据**：令牌在本包单测里绿了不算数，还要有一个真实消费包（如 `packages/agent/dsh-session`）的装配用例跑到它。

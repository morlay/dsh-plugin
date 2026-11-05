# 用 AST 合成 typert 产物（typert-generator 的机制与取舍）

状态：已实现
范围：`devpackages/typert-generator/` 的输入、产物与规则落点——为什么是纯语法合成而不是类型图。
约束：上游 `@deepseek-ai/*` 与 `vendor/**` 只读；本包不读上游 tsconfig、不依赖任何 TypeScript 版本，也不生成声明树。

## 结论摘要

| 议题     | 结论                                                                                      | 一句话理由                                                                           |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 输入     | 方法面取上游包**源码**，类型面取**声明树**（`dtsRoot` 入参）                              | 两侧都已是 AST 文本，没有需要类型推断的场景                                          |
| 合成方式 | oxc 的 AST：源码给方法与签名，声明树给类型                                                | 不建类型图 —— 声明树已摊平（interface / type / enum 都在），类型检查器给不出额外信息 |
| 产物     | `lib/typert.host.ts`、`lib/typert.client.ts`（双面包才有）、`lib/typert.remote-client.ts` | 出口名与源文件名不同构，名称与位置由上游 `vendor/steps.ts` 显式指定                  |
| 落点     | `vendor/steps.ts` 的 `prebuild` 阶段（`{ type: "typert" }`）                              | 前置是 sync + patch 的干净基线（上游 tsconfig 已在 patch 阶段删掉）                  |

## 事实基线

- 入口 [`generateTypert`](../../src/index.ts)：`upstreamRoot`（上游 clone，产地里的 `sourceLocation` 相对它）、
  `dtsRoot`（声明树）、`write`（缺省只返回文本，供预演 / 对照）；产物三件的形态见 [`src/index.ts`](../../src/index.ts)。
- 预演：`pnpm dlx @oxc-node/cli devpackages/typert-generator/src/cli.ts vendor/deepseek-harness target/dts [包名…]`。
- 判据与用例在 [`src/__tests__/`](../../src/__tests__)（`generate.spec.ts`、`reflection.spec.ts`、
  `schema.spec.ts`、`upstream-fixtures.spec.ts` 与快照）。
- **wire 上能否缺省一个 JSON 参数，看类型里有没有 `undefined`**：`options?: T` 与 `expectedRevision: number | undefined`
  都算（与上游 `typert/generator` 的 `includesRemoteAbsence` 同判据）。只按签名里的 `?` 判会漏掉后者：客户端省略实参时
  不写这个键（`api/gateway` 的 client 侧跳过 `undefined`），descriptor 少了 `acceptsUndefined` 就被判
  `missing "…"`——agent 预设页的「设为新任务默认」曾整条报这个错。

## 取舍

- **AST 合成，而不是建类型图**：逐包建一次 tsgo 类型图是分钟级，AST 全量合成只要几秒；代价是每条规则都要自己
  在语法层写清（类型语法映射见 [`src/schema.ts`](../../src/schema.ts)，方法面与产物文本见 [`src/index.ts`](../../src/index.ts)）。
- **声明树由调用方给，而不是本包生成**：`dtsRoot` 是入参，全仓声明由 `@local/devkit` 的 `generateWorkspaceDts`
  产出；本包只消费，不决定声明怎么生成。
- **不读上游 tsconfig**：上游配置文件在 patch 阶段就被删掉，生成器只按 AST 工作——这条约束让生成不依赖上游的
  编译配置面。

## 开放问题

无。

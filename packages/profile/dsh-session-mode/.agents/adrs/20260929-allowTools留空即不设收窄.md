# `allowTools` 留空即不设收窄

状态：已采纳

背景：`allowTools` 原本是**必填**（每个模式至少要列一个工具，空名单在装配期直接拒），理由是"想要'全都要'就
列出全部，别留空"——而"全部"当时是 toolkit 的 `TOOLKIT_TOOL_NAMES` 派生的那份清单。行清单改为归会话挂着的
shipped preset 之后（[ADR-不再持有行清单](../../../../bundles/session-mode-profile/.agents/adrs/20260929-不再持有行清单.md)），
"全部"不再是我们知道的一份清单：它随 preset 变，抄一份进模式定义只会与行清单漂移。

**决定**

`allowTools` 变成**可选**：不写（schema 归一化成空数组）表示**不设收窄**——这个会话用它挂着的 preset 提供的全部
工具。要收窄就列名单（`chat` 列提问 + 联网三件）。

- schema：`.default([])` 保留（归一化后仍是数组），描述改成"留空就是不设收窄"；`configProblem` 删掉"每个模式
  至少要一个工具"这条校验（`role`、`default`、`defaultModel` 的校验照旧）。
- 收口（本包 [`src/scope.ts`](../../src/scope.ts) 的 `SessionScope`）：`allowTools` 为空数组时**不登记收窄**——装配期
  不过滤工具与 `tool:<名字>` section、不装执行层守卫（同一个 agent 之前登记的那份被收回）。
- 渲染（`rows.ts`）：`allowTools` 不写就不出现在行 config 里。

**考虑过的选项**

- **留空 = 一件工具都没有**：与"没配 = 写错了"的旧语义一致，但把"全都要"逼成抄清单，而清单已经不是我们的。
- **用显式的 `allowTools: "*"`**：多一个魔法值要解释，留空已经足够表达。

**后果**

- `coding` 不写 `allowTools`（用 preset 的全部工具），`chat` 仍收成三件：两个模式的差异更贴"会话怎么用这些行"。
- 空白名单不再有装配期报错——写错成空数组不再被拦。代价可接受：它对"这个模式要收窄吗"的答案是"不收窄"，
  不是静默失效。
- 判据：[`session-mode.spec.ts`](../../src/__tests__/session-mode.spec.ts)（留空 = 宿主平面的全部工具照常进目录）与
  [`scope.spec.ts`](../../src/__tests__/scope.spec.ts)（留空不缩目录与 section、不装守卫、从收窄换回留空时工具都回来）。

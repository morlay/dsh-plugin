# 上游桌面键盘 fixture 的 tsconfig outDir 不符 clean 约定

状态：触发中（`patches/desktop-keyboard-test-outdir.patch` 在每次 `just vendor build` 里生效，否则 clean 直接失败）

**现象**

上游 0.1.7-rc.2 新增 `vendor/deepseek-harness/tsconfig.desktop-keyboard-tests.json`（被同版 `tsconfig.client.json:46` 引用），它的 `outDir` 是 `lib/desktop-keyboard-test-types`——不以 `/types` 结尾。而上游
`scripts/clean.ts:142-144` 遍历根 tsconfig 的项目引用图时只接受两种 outDir：`lib/<x>/types`，或
`native/system/packages/entry/lib`，其余一律抛
`clean: expected TypeScript outDir to end in /types: lib/desktop-keyboard-test-types`。

于是 `just vendor build`（`pnpm install && pnpm run clean && pnpm run build`）在 clean 这一步就失败，
rc.2 一个包都构建不出来。绕行是把 outDir 改成 `lib/desktop-keyboard-test-types/types`（clean 取
`dirname` 作为删除目标，仍删得掉整个 `lib/desktop-keyboard-test-types`），登记在
`patches/steps.json` 第二步。改的是上游数据（一行 outDir），不是 clean 的校验逻辑：校验被其余全仓 tsconfig 共用，改数据冲突面更小。

**影响**

- 撞上的人：任何跑 `just vendor sync → patch → build` 的人，第一次会看到 `pnpm run clean` 退出码 1（`error: recipe `build` failed`）。
- 上游后续版本若改这个 tsconfig（例如把 outDir 修成以 `/types` 结尾），`git apply` 失败——那正是评估该 patch 的信号。

**触发条件**

升级 `DEEPSEEK_HARNESS_VERSION` 时 `just vendor patch` 报 apply 失败，必须当场决定删 / 改 / 留。

**销账条件**

Done when：上游该 tsconfig 的 outDir 以 `/types` 结尾（或 `scripts/clean.ts` 不再强制该约定），删掉
`patches/desktop-keyboard-test-outdir.patch` 与 `patches/steps.json` 中对应那一步。

**不修的理由**

上游 `vendor/**` 只读，本地 patch 是既定例外（[ADR-20260917-上游以side-workspace版本锁定完整代码而非发布版本](../adrs/20260917-上游以side-workspace版本锁定完整代码而非发布版本.md)）；
这个 tsconfig 是 rc.2 才引入的文件，上游下一版自修的概率高，等一次同步比现在另想办法便宜。

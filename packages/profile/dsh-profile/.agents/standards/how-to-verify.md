# 如何验证

改动 host 层的装配（按 id 禁用上游行、`llm-pi-ai` / `web` 的 config、沙箱替换行、插入新行）时，除了包内
测试，**必须**跑一次真装配：

```sh
just profile
```

它装配一次真实 web profile 并读 `ctx.agentPresets` 的 roster 逐个打印装载结果（`verify-profile.mts`），
再检查每个 preset 的隔离判据（`verify-preset-isolation.mts`）。

**判据**：六个 preset（`coding` / `chat` / 官方 `standard` / `ptc` / `minimal` / `cordis`）都是 `ok`。

为什么这条对本包尤其重要：**本层的动作是全局的**——按 id 禁用一行、整体替换一行的 `config`，官方那几个
preset 的行一样吃。2026-09-22 禁用 `subagent-model-selection-settings` 就把官方 `standard` / `ptc` /
`cordis` 打成了 `requires ... in the Host scope`（三个 preset 全 broken），而 `patch.spec.ts` 当时全绿：
它比对的是行清单，不是装载结果。

所以改本层前先问一句：**这个动作是部署事实（沙箱实现、llm 路由、搜索后端——所有模式理应一致）还是某个
模式的取舍？** 后者该由那个模式自己解决（`persona` 行、`isolate` 组、抢 waterfall），不该在这里做全局开关
——实例：`fs-observation-policy` 不禁用，改由 `coding` 自带 `relax-intent` 抵消。

包内测试（`pnpm exec vitest run packages/profile/dsh-profile`）覆盖 patch 与上游层的组合结果（用上游自己的
`applyEntryPatches` 组合 base + web-app + 本 patch，断言"只多出我们声明的那几条禁用"）；和真装配两者都要跑。

模式侧（行清单、`isolate` 组、`registry.default`）的判据见
[`@morlay/dsh-agent-preset` 的规范](../../../dsh-agent-preset/.agents/standards/how-to-verify.md)。

# 如何验证

改动 host 层的装配（按 id 禁用上游行、`llm-pi-ai` / `web` 的 config、沙箱替换行、插入新行）时，除了包内
测试，**必须**跑一次真装配：

```sh
just profile
```

两支探针各管一半：

- `verify-session-mode.mts`：装配面的四条事实——注入通道全局一份（`ctx.contextAssembler`）、模式收口那一行
  装上了（`ctx.sessionToolScope`）、**`ctx.agentPresets` 不存在**（官方 agent preset 那一套确实被本层关掉）、
  `ctx.sessionModes.roster()` 等于 `session-mode` 行的 config。
- `verify-profile.mts`：模式清单在，外加会话列表 / 归档 / `/session-editor` 路由那几条与模式无关的判据。

**判据**：两支探针都没有 `failures`。最要紧的一条是 `ctx.agentPresets` **必须缺席**——它还在就说明官方那套
又回来了（两套并行机制、每 revision 一棵 Loader 子树）。

为什么这条对本包尤其重要：**本层的动作是全局的**——按 id 禁用一行、整体替换一行的 `config`，活在同一份装配
里的行都吃。2026-09-22 禁用 `subagent-model-selection-settings` 就把当时仍在的官方 `standard` / `ptc` /
`cordis` preset 打成了 `requires ... in the Host scope`，而 `patch.spec.ts` 当时全绿：它比对的是行清单，
不是装载结果。

所以改本层前先问一句：**这个动作是部署事实（沙箱实现、llm 路由、搜索后端——所有模式理应一致）还是某个
模式的取舍？** 后者该由那个模式自己表达（`session-mode` 的 `config.modes`），不该在这里做全局开关。
实例的沿革：`fs-observation-policy` 曾是"模式取舍"，靠 `coding` 自带 `relax-intent` 抢 waterfall 抵消；
官方 agent preset 退出后（2026-09-24），它改回本层的禁用行——不再需要按模式表达。

包内测试（`pnpm exec vitest run packages/profile/dsh-profile`）覆盖 patch 与上游层的组合结果（用上游自己的
`applyEntryPatches` 组合 base + web-app + 本 patch，断言"禁用就是那几条、默认值确实落在对应行上"）；
和真装配两者都要跑。

模式侧（模式清单、persona 与收口的判据）见
[`@morlay/dsh-session-mode` 的规范](../../../dsh-session-mode/.agents/standards/how-to-verify.md)。

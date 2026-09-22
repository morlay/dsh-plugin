# 如何验证

改动**装配形状**之外的任何东西——尤其是 host 层的按 id 禁用、`agent-preset-registry` 的配置、官方
shipped preset 相关的判断——除了包内测试，还要跑一次真装配：

```sh
just profile
```

它装配一次真实 web profile（`apps/dsh-custom-next/.dsh-store/profiles/web`，由 `just custom dev --web`
或 `just custom desktop` 准备），读 `ctx.agentPresets` 的 roster 逐个打印装载结果，并顺带检查
`POST /session-editor` 是否命中我们自己的 handler（那是另一个只有真装配才看得见的顺序问题）。

**判据**：六个 preset（`coding` / `chat` / 官方 `standard` / `ptc` / `minimal` / `cordis`）都是 `ok`。
任何一个 `broken` 都要先修——静态断言（`patch.spec.ts` 的行 id 与 config 比对）看不见装载结果，
而按 id 禁用 host 行是**全局**动作，会连带影响官方 preset 的行：2026-09-22 禁用
`subagent-model-selection-settings` 就把官方 `standard` / `ptc` / `cordis` 打成了
`requires ... in the Host scope`。

包内测试（`pnpm exec vitest run packages/preset/dsh-preset`）覆盖的是行清单与 patch 的一致性；
两者都要跑，顺序无所谓。

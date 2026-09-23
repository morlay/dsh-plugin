# 如何验证

改动**装配形状**（模式的行清单、`isolate` 组、`registry` 的 `default`）时，除了包内测试，还要跑一次真装配：

```sh
pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-profile.mts
pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-preset-isolation.mts
```

它们装配真实 web profile（`apps/dsh-custom-next/.dsh-store/profiles/web`，由
`just custom dev --web` 或 `just custom desktop` 准备）：

1. `verify-profile.mts`：读 `ctx.agentPresets` 的 roster 逐个打印装载结果，并顺带检查
   `POST /session-editor` 是否命中我们自己的 handler（那是另一个只有真装配才看得见的顺序问题）。
2. `verify-preset-isolation.mts`：检查注入通道在装配平面**有且只有一份**。

**判据**：

- roster 里没有 `broken`——静态断言（`patch.spec.ts` 的行 id 与 config 比对）看不见装载结果。
- 通道位置：装配平面（root）**必须**有 `contextAssembler`；任何 preset 的 mount 里**不得**再有第二份
  （出现第二份就是回归）。我们自己的两个模式 `coding` / `chat` 必须真的挂上；官方四个 preset
  （`standard` / `ptc` / `minimal` / `cordis`）已被 [`@morlay/dsh-profile`](../../../dsh-profile/README.md) 的
  patch 关掉，不在 roster 里。这组判据来自一个真回归（2026-09-22）：通道住 host 层时它的注册表不分 scope，
  官方 preset 的会话照样收到我们的工作区指令、skill 目录与中文文案——静态断言全绿，只有真装配能看见。见
  [ADR 通道作为全局服务装配不隔离](../../../../context/dsh-context-assembler/.agents/adrs/20260923-通道作为全局服务装配不隔离.md)。
- 按模式收口：`chat` 的装配**没有**动态快照（沙箱策略 / 审批策略那两条 context），`coding` **有**。后者是
  配对判据——少了它，"全局关掉动态快照"也能让前者通过。

包内测试（`pnpm exec vitest run packages/profile/dsh-agent-preset`）覆盖行清单与 patch 的一致性、`isolate`
组的完整性、以及 `relax-intent` 的归属判据与 `prepend` 顺序；和真装配两者都要跑，顺序无所谓。

**host 层**（按 id 禁用、llm route、搜索后端、沙箱）的判据在
[`@morlay/dsh-profile` 的规范](../../../dsh-profile/.agents/standards/how-to-verify.md)——那里的动作是全局的，
风险面不同。

# 如何验证（Seatbelt e2e 门控）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的环境门控与落点。

## 常规落点（`src/__tests__/`）

- `rules.spec.ts` / `dialects.spec.ts` / `plugin.spec.ts`：规则解析与命中优先级、平台方言的 argv / SBPL 生成、
  插件装配——纯 node，任何平台可跑。
- `config-surface.spec.ts` / `field-wording.spec.ts`：六个字段的 schema 形状（`access` 可改、其余
  `.volatile().disabled()`）与字段文案。
- `policy.spec.ts`：`sandbox:policy` 文本的接管（按 agent 作用域覆盖、规则非空时追加本部署条目、agentless 保持
  官方那条）。
- 装配行（禁官方 `sandbox` / `fs-sandbox` + 插本包行）的守卫在采用方的
  `packages/bundles/sandbox-profile/src/__tests__/patch.spec.ts`。

## Seatbelt e2e 门控（本地人工验证）

- `seatbelt.e2e.spec.ts` 只在 **macOS 且 `/usr/bin/sandbox-exec` 探针可用**时执行（`platform !== "darwin"` 或
  探针非零即跳过）。
- **CI（ubuntu）恒跳过**——它不是 CI 证据，属**本地人工验证**：改动沙箱策略、额外可写根或拒绝项后，在本机跑一次
  这条 e2e 并贴输出。

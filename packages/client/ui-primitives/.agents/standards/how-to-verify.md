# 如何验证（styling / token 机制）

通用规则（证据矩阵、jsdom pragma、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包机制测试的口径与落点。

## 机制口径（`src/__tests__/`）

- **`Token`**（node）：属性名转 kebab-case、自定义属性（`--*`）原样保留、数字 / 字符串 / 组合子值
  规范化 → `token.spec.ts`。
- **`Styling` / `styled`**（jsdom）：规则进 head、按 id 去重、组件带 `data-css-*` 属性 →
  `styling.spec.tsx`。
- **token 表一致性**（node + 文件系统）：`dsw` 树与上游 `ui-theme` 源里的 `--dsw-*` 声明逐一对应 →
  `design-tokens.spec.ts`。
- **引用解析与渲染**：`findReferences` 等解析（node）→ `reference.spec.ts`；本地引用成官方 chip、
  外部地址保持锚点、普通文本与代码不受影响（jsdom）→ `reference-markdown.spec.tsx`。
- **设置表单原语**（搬自上游，判据照抄上游测试）：模型（node）→ `settings-form-model.spec.ts`；
  字段控件（jsdom）→ `settings-form-fields.spec.tsx`；表单框（jsdom）→ `settings-form.spec.tsx`。
  三个 spec 都经 `@morlay/dsh-client-ui-primitives/client` 导入——出口漏了导出就在这里报红。

## 判据

- 样式 / token 的**机制**在这一层测；别的包只消费——locale 数据表**不重复测**，
  口径见 [ui-conversation 的验证规范](../../../../../packages/session/ui-conversation/.agents/standards/how-to-verify.md)。
- 设置表单原语的**行为**在这一层测（上游判据为准，不按我们的偏好放宽）；两张卡片只装配，不重测模型。
  上游升级后重跑这三个 spec 并对照上游同名测试，纪律见
  [ADR-设置表单原语搬进client半](../adrs/20260923-设置表单原语搬进client半.md)。

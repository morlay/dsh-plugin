# @morlay/dsh-client-ui-primitives

对话 UI 的 **css-in-js 样式层**（`styled` / `Token` / `Styling`，消费官方主题已注入的 `--dsw-*` 变量，
因此不需要 CSS Modules 那一步预编译，源码可直接加载），被 fork 的对话 UI 共用的
**引用解析与渲染转换**（`findReferences` / `parseReferenceToken`，源码上唯一一份，
[`@morlay/dsh-reference`](../../context/dsh-reference/README.md) 的引用展开也复用它），以及从上游 fork 过来的
**设置表单原语**（暂存式表单模型 `SettingsFormModel` + 字段控件 + 表单框，样式同样走本包的 `styled` / `dsw`）。

设计取舍（为什么 css-in-js、为什么生成 token 树、与上游 `ui-primitives` 的关系）见
[ADR-css-in-js样式层与官方token消费](./.agents/adrs/20260917-css-in-js样式层与官方token消费.md)；
设置表单原语的搬迁与同步纪律见
[ADR-设置表单原语搬进client半](./.agents/adrs/20260923-设置表单原语搬进client半.md)。

## 能力

| 导出                                         | 用途                                                                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styled('div')(style, …)`                    | 生成带 `data-css-*` 的组件；多个样式对象深合并（变体叠基样式）                                                                                                                                  |
| `styling`                                    | `props(style)` 取 `data-css-*` 属性、`keyframes`、`injectGlobals`、`sheets()`                                                                                                                   |
| `Token`                                      | 变量引用代理（`vars`）、局部变量赋值（`assignVars`）、变体选择器（`variants`）、组合子（`calc` / `min` / `max` / `url` / `colorMix` / `colorScale` / `fallbackVar` / `val`）                    |
| `dsw`                                        | 官方主题变量引用：`dsw.alias.bg.base` → `var(--dsw-alias-bg-base)`                                                                                                                              |
| `SettingsFormModel`                          | 暂存式表单模型：草稿（`edit` / `resetField` / `save` / `discard`）、字段状态（`field`）、表单状态（`shell`）、快照投影（`bind`）；`settingsNumberField` / `settingsTextField` 给字段的转换 spec |
| `SettingsForm`                               | 设置表单框：不可用 / 只读 / 保存中 / 保存失败各状态，离开页面时丢弃草稿                                                                                                                         |
| `SettingsValueField` / `SettingsSecretField` | 字段控件：标签、草稿文本、覆盖徽标与重置、非法提示、可选说明面板；控件只上报用户输入，不写盘                                                                                                    |
| `findReferences` / `parseReferenceToken`     | host 面：`@` 引用的统一解析与形态归一（`@path` / `@"path"` / `skill:name` → 结构化引用与 span），`Reference` / `ReferenceSpan` 类型                                                             |
| `designTokens`                               | 生成的 token 树，叶子是官方默认值（可作 fallback 与类型推导来源）                                                                                                                               |

样式注入是**惰性立即注入**（某条规则第一次生成时就 append `<style data-css="…">`，
按 id 去重），不提供 Provider。

## token 树

`designTokens`（`src/client/theme.generated.ts`）由 `scripts/gen-design-tokens.mts` 从
上游主题源码生成，共 **367 个 `--dsw-*`**：叶子是该变量在 light 主题里的默认值。
生成机制、`"$"` 键语义与守卫判据见
[ADR-css-in-js样式层与官方token消费](./.agents/adrs/20260917-css-in-js样式层与官方token消费.md)。

## 设置表单原语

上游 `@deepseek-ai/dsh-client-ui-primitives` 的 settings-form 原语搬在 `src/client/settings-form/`
（`form-model.ts` / `fields.tsx` / `SettingsForm.tsx`，导出面同形同名）。消费方从 client 出口取：

```ts
import {
  SettingsFormModel,
  settingsNumberField,
  SettingsForm,
  SettingsValueField,
} from "@morlay/dsh-client-ui-primitives/client";

const form = new SettingsFormModel(scope, [settingsNumberField("timeoutMs")]);
const store = form.bind(() => ({ ...form.shell(), timeoutMs: form.field("timeoutMs") }));
```

控件只上报用户输入，`save` 是唯一写盘点；判据（暂存、校验与非法输入、可用性与只读、revision 栅栏、
保存失败保留草稿）见[如何验证](./.agents/standards/how-to-verify.md)，搬迁与同步纪律见
[ADR-设置表单原语搬进client半](./.agents/adrs/20260923-设置表单原语搬进client半.md)。

## 装配

本包是 profile 的一行 insert（client 半按 `dsh.client` 声明加载）；本仓库的装配真源是
`packages/session/better-session/cordis.patch.yml` 的 `ui-primitives-fork` 行。

## 已知限制

- token 值只在生成物里（默认值），运行时不重新定义官方变量；主题切换仍由官方 `--dsw-*` 覆盖完成。
- `styled` 不做 polymorphic（无 `as` / `asChild`）：需要换渲染元素时直接 `styled('a')` 或包一层组件。
- 设置表单原语是上游三份源的对照副本，**没有漂移守卫**：上游升级后要人工 diff（纪律见
  [ADR-设置表单原语搬进client半](./.agents/adrs/20260923-设置表单原语搬进client半.md)）。

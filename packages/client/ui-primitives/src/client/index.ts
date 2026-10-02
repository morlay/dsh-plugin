import type { Context } from "@deepseek-ai/cordis";
import * as schemaForm from "./schema-form/index.ts";

// 官方那套基础组件（`Button` / `Menu` / `Modal` / `Switch` / `SegmentedControl` / `DisclosureRow` / 图标 …）统一
// 从这里转出：业务包只向本包取控件，不必各自去认官方包名。同名以本包 fork 的那份为准（下面显式再导出
// `SettingsForm` / `SettingsValueField` / `SettingsSecretField` / `SettingsFormModel` —— 它们是同一套 API 的本地
// 实现，样式走包内 css-in-js），星号导出之间的同名项因此不会被判成歧义。
export * from "@deepseek-ai/dsh-client-ui-primitives";

export * from "./styling/index.ts";
export * from "./theme.ts";
export * from "./markdown-labels.ts";
export * from "./settings-form/index.ts";
// 本包 fork 的那套设置面原语的**具名**再导出：官方 `ui-primitives` 也导出同名成员，两个星号导出之间必须显式点名，
// 否则 TypeScript 判成歧义、两边都不导出。这里以本包这份为准（同一套 API，样式走包内 css-in-js）。
export {
  SettingsFieldRow,
  SettingsForm,
  SettingsFormModel,
  SettingsSecretField,
  SettingsValueField,
  settingsNumberField,
  settingsTextField,
} from "./settings-form/index.ts";
export type {
  SettingsFieldProps,
  SettingsFieldRowProps,
  SettingsFieldSpec,
  SettingsFieldState,
  SettingsFieldWrite,
  SettingsFormActions,
  SettingsFormLabels,
  SettingsFormPathOp,
  SettingsFormProps,
  SettingsFormScope,
  SettingsFormScopeSnapshot,
  SettingsFormShell,
  SettingsSecretSpec,
} from "./settings-form/index.ts";
export * from "./controls/index.ts";
// `Button` 是本包包装版（官方那份 + 文字不换行）：两个星号导出之间必须显式点名，否则判成歧义。
export { Button, type ButtonProps } from "./controls/index.ts";
// 按行 schema 自动生成的行配置页（原 `@morlay/dsh-client-ui-schema-form/client`，2026-09-28 合并进来）：
// 两者都是"对话 UI / 设置页的基础面"，拆成两行会各自注册一遍、还要求每个 bundle 都插齐两行。
// 只**具名导出**它那一面的门面：`export *` 会与 settings-form 的样式 / token 重名。
export * as schemaForm from "./schema-form/index.ts";
export {
  NS as SCHEMA_FORM_NS,
  SchemaFormController,
  SchemaFormHints,
  failureOf,
  projectRoot,
  rowRegistrations,
  walkFields,
} from "./schema-form/index.ts";
export type {
  FieldNode,
  FieldMeta,
  SchemaFormActions,
  SchemaFormFace,
  SchemaFormLocaleKey,
  SchemaFormState,
  SelectOption,
  SelectSpec,
  SuggestedKeys,
  ValidationFailure,
  WalkedField,
} from "./schema-form/index.ts";

export {
  findReferences,
  formatReference,
  formatReferenceMention,
  isLocalReference,
  parseReference,
  parseReferenceToken,
} from "../reference.ts";
export type { Reference, ReferenceSpan } from "../reference.ts";
export { ReferenceMarkdown, referenceMentions } from "../reference-markdown.tsx";
export type { ReferenceActions, ReferenceMarkdownProps } from "../reference-markdown.tsx";

// `apply` 需要的**服务名**（cordis 服务，不是包名）：样式与引用那半不要服务，schema 表单那半要槽位、字典与
// 配置表单。本包不是装配行，所以这份清单不再由 Loader 读；它由 `schemaForm.apply` 自己的 `ctx.inject` 用，
// 调用方（内联本包的 client 行）因此不必自己排服务顺序。值直接取自 schema 表单那一面，不另抄一份。
export const inject: readonly string[] = [...schemaForm.inject];

// 装上基础面：字典、字段槽与按行配置页。
//
// 由**内联本包的 client 行**调用（本包不是装配行）：多份副本各带一份这份代码，`schemaForm.apply` 保证同一
// 运行时只装配一次（服务已在场就返回）。见本包 `.agents/adrs/20261001-暂时内联而不是装配行.md`。
export function apply(ctx: Context): void {
  schemaForm.apply(ctx);
}

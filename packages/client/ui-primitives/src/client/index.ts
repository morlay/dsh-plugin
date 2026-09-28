import type { Context } from "@deepseek-ai/cordis";
import * as schemaForm from "./schema-form/index.ts";

export * from "./styling/index.ts";
export * from "./theme.ts";
export * from "./markdown-labels.ts";
export * from "./settings-form/index.ts";
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

/**
 * 需要的**服务名**：样式与引用那半不要服务，schema 表单那半要槽位、字典与配置表单。
 *
 * 与包清单里的 `dsh.client.inject` 不是一回事：那份是**装配行 id**（谁先到），交给模块系统排 arrival 顺序；
 * 这里读的是 cordis 服务名（谁已 provide），Loader 拿它决定这一行何时才算 active。写错成包名，这一行就永远
 * pending（`web boot: ... waiting for services`）。
 *
 * 值直接取自 schema 表单那一面，不另抄一份清单。
 */
export const inject: readonly string[] = [...schemaForm.inject];

export function apply(ctx: Context): void {
  schemaForm.apply(ctx);
}

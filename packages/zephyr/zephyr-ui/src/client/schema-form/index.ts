// client 半：给出按 schema 生成的配置页的装配面（字典 + 表单 Factory + 字段槽）。
//
// | 面                                  | 呈现                                                          |
// | ----------------------------------- | ------------------------------------------------------------- |
// | Factory `settings.schema-form.form` | 配置页的渲染体：调用方经 `renderFactorySlot` 渲染同一份表单   |
// | `settings.schema-form.field`        | chain 槽：业务方按 `role` 或 `ns + path` 认领字段的控件与文案 |
//
// 数据面是 host 的 settings 投影与共享配置表单（`ctx.configForms` / `ctx.settingsSchema`）。

import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { Context } from "@morlay/zephyr";
import { SchemaFormHintsDefault, SERVICE_NAME } from "./hints.ts";
import { en, zh } from "./locales.ts";
import { SchemaForm } from "./SchemaForm.tsx";

// 本包字典与槽位文案的命名空间。
export const NS = "settings.schema-form";

// 需要的服务：槽位、字典、共享配置表单与 schema 服务。
//
// 调用方（内联本包的 client 行）在 `onInit` 里调 `apply`，那时代码里注入的服务已就位；这份清单只用来
// 判断「到齐了没」，因此与 zephyr 的字段注入同一口径。
export const inject = ["slots", "locale", "configForms", "settingsSchema"];

export type {
  SchemaFieldComponentProps,
  SchemaFieldMatch,
  SchemaFieldOwnerProps,
  SchemaFieldSelect,
  SchemaFormProps,
} from "./slot-contract.ts";
export type { SchemaFormActions, SchemaFormFace, SchemaFormState } from "./controller.ts";
export type { FieldNode, FieldMeta, WalkedField } from "./schema-node.ts";
export type { SchemaFormLocaleKey } from "./locales.ts";
export { SchemaFieldDefault, InlineValue, tokenText, tokenTone, valueText } from "./value.tsx";
export { parseFor } from "./fields.tsx";
export { containerShape, editorLines, visibleFields } from "./lines.ts";
export type { EditorLine, FoldState } from "./lines.ts";
export { SchemaFormController, canRender, optionsFor, projectRoot } from "./controller.ts";
// 行投影的输入件：外部的「真配置验收」要按与控制器同一套算法自己排行（见各消费包 client 面的 __tests__）。
export { addableAt, fieldKey } from "./controller.ts";
export { readPath } from "./schema-node.ts";
export type { SchemaFormTranslate } from "./slot-contract.ts";
export { zh } from "./locales.ts";
export { failureOf } from "./draft.ts";
export type { ValidationFailure } from "./draft.ts";
export { walkFields, projectNode } from "./schema-node.ts";
export {
  SchemaFormHints,
  SchemaFormHintsDefault,
  SERVICE_NAME,
  schemaFormHintsOf,
} from "./hints.ts";
export type {
  FieldText,
  SchemaFormHintsFace,
  SelectOption,
  SelectSpec,
  SuggestedKeysReader,
} from "./hints.ts";
export type { SuggestedKeys } from "./schema-node.ts";

// 装上本包：提示面、字典与字段槽的 Factory。
//
// 调用方是**内联了本包的 client 行**（本包不是装配行）：inline 后每个消费行的产物里各带一份这份代码、
// 都会调到这里，所以保证同一运行时只装一次（服务已在场就返回）。
export function apply(ctx: Context): void {
  // 提示面已在场 = 另一份副本装过了：字典 / 槽都不再重复注册。
  if (ctx.root.reflect.get(SERVICE_NAME, false) !== undefined) return;
  install(ctx);
}

function install(ctx: Context): void {
  // 提示面（dict 的候选键）：同一次 apply 里提供，业务插件注册读数，本包的字段投影读它。
  //
  // **必须最先提供，并且挂在 root 上**：多份副本各自的 `apply` 会先后进来，上面的检查靠它判断
  // 「另一份已经装过」。放在 `locale.register` 之前是必需的：否则两次调用都可能先通过检查、再各注册一次
  // `settings.schema-form` 字典，第二个抛 `locale namespace "settings.schema-form" already has locale "zh"`。
  const hints = new SchemaFormHintsDefault();
  const offHints = ctx.root.reflect.provide(SERVICE_NAME, hints);
  ctx.effect(() => offHints);

  // 字典。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }));

  // 字段槽的声明者：配置页的渲染体。
  ctx.effect(() =>
    ctx.slots.registerFactory(
      {
        name: "settings.schema-form.form",
        scope: "root",
        children: { "settings.schema-form.field": { kind: "chain", scope: "root" } },
        locale: NS,
      },
      SchemaForm,
    ),
  );
}

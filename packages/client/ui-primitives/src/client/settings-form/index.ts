// 设置表单原语的 client 出口：模型 + 控件 + 表单框，命名与上游
// `@deepseek-ai/dsh-client-ui-primitives` 同形（搬迁记录见本包 .agents/adrs/）。

export { SettingsFormModel, settingsNumberField, settingsTextField } from "./form-model.ts";
export type {
  SettingsFieldSpec,
  SettingsFieldState,
  SettingsFieldWrite,
  SettingsFormActions,
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormScopeSnapshot,
  SettingsFormShell,
  SettingsSecretSpec,
} from "./form-model.ts";
export { SettingsSecretField, SettingsValueField } from "./fields.tsx";
export type { SettingsFieldProps } from "./fields.tsx";
export { SettingsForm } from "./SettingsForm.tsx";
export type { SettingsFormLabels, SettingsFormProps } from "./SettingsForm.tsx";

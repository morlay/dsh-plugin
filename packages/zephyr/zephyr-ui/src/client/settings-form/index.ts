// 设置表单原语的 client 出口：**直接用上游那份**（同名同形的 `SettingsForm` / 两个字段控件 / 表单模型，样式
// 本来就是上游的 `.module.css`），这里只留本包自造的那一个字段行——上游的 `SettingsValueField` 摆不下
// 「标签 + 控件 + 说明 + 覆盖标记」这一整行。

export { SettingsFieldRow } from "./SettingsFieldRow.tsx";
export type { SettingsFieldRowProps } from "./SettingsFieldRow.tsx";

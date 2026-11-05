// 布局原语：业务页面只摆结构与选档，不写样式。
//
// 通用原语（`Stack` / `Row` / `Text` / `Panel`）覆盖设置面的绝大多数排法；成型的那几件（字段行
// `SettingsFieldRow`、标签输入 `TagInput` 等）住在 `../controls` 与 `../settings-form`。

export { Row, type RowProps } from "./Row.tsx";
export { Stack, type StackProps } from "./Stack.tsx";
export { Text, type TextProps } from "./Text.tsx";
export type {
  LayoutAlign,
  LayoutGap,
  LayoutJustify,
  LayoutPad,
  TextSize,
  TextTone,
} from "./scales.ts";

// 设置面通用控件：按钮、图标按钮、选择器、标签输入、多行文本。
//
// 官方那套基础组件（`Menu` / `Modal` / `Switch` / …）由本包统一 re-export（见 `../index.ts`），业务包只从这里取控件。
// 两类"带候选"的控件共用同一套「搜索 + 候选」交互：
// - **multi-input**（`TagInput`）：多值 + 自由输入，候选只是加速；
// - **searchable**（`SearchSelect`）：单值，从候选里搜着选。

export { Button, type ButtonProps } from "./Button.tsx";
export { IconButton, type IconButtonProps } from "./IconButton.tsx";
export { MultilineField, type MultilineFieldProps } from "./MultilineField.tsx";
export {
  SearchSelect,
  type SearchSelectOption,
  type SearchSelectProps,
} from "./SearchSelect.tsx";
export { TagInput, type TagInputProps } from "./TagInput.tsx";
export { mergeTags, parseTagList } from "./tags.ts";

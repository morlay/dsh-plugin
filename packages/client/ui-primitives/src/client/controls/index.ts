// 设置面通用控件：方形图标按钮、选择器、标签输入、多行文本。
// 官方那套控件（`Button` / `Menu` / `Modal` / `Switch` / …）由本包统一 re-export（见 `../index.ts`），
// 业务包只从这里取控件。

export { IconButton, type IconButtonProps } from "./IconButton.tsx";
export { MultilineField, type MultilineFieldProps } from "./MultilineField.tsx";
export { SelectMenu, type SelectMenuOption, type SelectMenuProps } from "./SelectMenu.tsx";
export { TagInput, type TagInputProps } from "./TagInput.tsx";
export { mergeTags, parseTagList } from "./tags.ts";

// 多行文本：官方通用表单只有单行控件，这个按官方输入框的数值画（边框 / 圆角 / 字号 / 内距），
// 标签与说明由外面的字段行给（见 `settings-form` 的 `SettingsFieldRow`）。

import type { TextareaHTMLAttributes } from "react";
import { classes } from "./classes.ts";
import css from "./MultilineField.module.css";

export type MultilineFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function MultilineField({ rows = 3, className, ...rest }: MultilineFieldProps) {
  return (
    <textarea
      rows={rows}
      data-role="multiline-field"
      className={classes(css.multiline, className)}
      {...rest}
    />
  );
}

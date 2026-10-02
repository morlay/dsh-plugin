// 图标按钮：没有文字、没有边框的方形按钮（官方侧边栏那种几何）。`label` 是它唯一的无障碍名。

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classes } from "./classes.ts";
import css from "./IconButton.module.css";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  // 无障碍名（图标没有文字，这个名字是它唯一的标识）。
  label: string;
  // 图标。
  children: ReactNode;
  // 形状档：缺省是设置面那种方形圆角；`circle` 是对话动作行那种圆形。
  shape?: "square" | "circle";
}

export function IconButton({
  label,
  children,
  type = "button",
  shape = "square",
  className,
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      type={type}
      data-role="icon-button"
      aria-label={label}
      className={classes(css.iconButton, shape === "circle" ? css.circle : undefined, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// 图标按钮：没有文字、没有边框的方形按钮（官方侧边栏那种几何）。`label` 是它唯一的无障碍名。

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { styled } from "../styling/styled.tsx";
import { styles } from "./controls.styles.ts";

const Button = styled("button")(styles.iconButton);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  // 无障碍名（图标没有文字，这个名字是它唯一的标识）。
  label: string;
  // 图标。
  children: ReactNode;
}

export function IconButton({ label, children, type = "button", ...rest }: IconButtonProps): ReactNode {
  return (
    <Button type={type} data-role="icon-button" aria-label={label} {...rest}>
      {children}
    </Button>
  );
}

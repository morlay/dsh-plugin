// 无障碍隐藏文本：给屏幕阅读器的一句话，视觉上不占位（图标按钮旁边的状态说明就用它）。

import type { HTMLAttributes, ReactNode } from "react";
import css from "./VisuallyHidden.module.css";

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function VisuallyHidden({ children, ...rest }: VisuallyHiddenProps): ReactNode {
  return (
    <span className={css.hidden} {...rest}>
      {children}
    </span>
  );
}

// 对话里的时间标签：平时透明，指针悬停或用键盘进入所在那一行（`[data-time-hover-root]`）才显形。

import type { HTMLAttributes, ReactNode } from "react";
import { classes } from "./classes.ts";
import css from "./TimeLabel.module.css";

export type TimeLabelProps = HTMLAttributes<HTMLSpanElement>;

export function TimeLabel({ className, children, ...rest }: TimeLabelProps): ReactNode {
  return (
    <span className={classes(css.label, className)} {...rest}>
      {children}
    </span>
  );
}

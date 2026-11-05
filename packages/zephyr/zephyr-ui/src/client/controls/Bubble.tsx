// 对话气泡：一条消息的内容块（底色 + 大圆角 + 内距 + 自己的最大宽度）。
//
// 宽度上限（`min(525px, 82%)`）归它：消息列多宽是对话面的口径，不该让每个调用方各写一遍。

import type { HTMLAttributes, ReactNode } from "react";
import { classes } from "./classes.ts";
import css from "./Bubble.module.css";

export type BubbleProps = HTMLAttributes<HTMLDivElement>;

export function Bubble({ className, children, ...rest }: BubbleProps): ReactNode {
  return (
    <div className={classes(css.bubble, className)} {...rest}>
      {children}
    </div>
  );
}

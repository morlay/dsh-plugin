// 浮层卡片：锚在某个控件旁边的面板（统计弹窗、筛选浮层）。定位（`style` 里的 left/top）由调用方给，
// 尺寸档、圆角、阴影与底色归这里。

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { classes } from "./classes.ts";
import css from "./PopoverPanel.module.css";

export type PopoverPanelProps = HTMLAttributes<HTMLDivElement>;

export const PopoverPanel = forwardRef<HTMLDivElement, PopoverPanelProps>(function PopoverPanel(
  { className, children, ...rest },
  ref,
): ReactNode {
  return (
    <div ref={ref} className={classes(css.panel, className)} {...rest}>
      {children}
    </div>
  );
});

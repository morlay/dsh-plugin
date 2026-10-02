// `Row`：横向行 + 间距档。标题行的「左列文本 + 右侧控件」（`justify="between"`）、按钮排、标签排都用它。

import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { classes } from "../controls/classes.ts";
import css from "./layout.module.css";
import {
  alignClass,
  gapClass,
  justifyClass,
  padClass,
  type LayoutAlign,
  type LayoutGap,
  type LayoutJustify,
  type LayoutPad,
} from "./scales.ts";

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  // 渲染成哪个元素（行内摘要用 `span`）。
  as?: ElementType;
  // 子项之间的横向间距。
  gap?: LayoutGap;
  // 交叉轴对齐；缺省 `stretch`。
  align?: LayoutAlign;
  // 主轴分布；缺省从起点排。
  justify?: LayoutJustify;
  // 放不下就换行。
  wrap?: boolean;
  // 撑开：吃掉剩下的宽度并允许收缩。
  grow?: boolean;
  // 卡片底座（边框 + 圆角 + 底色）。
  boxed?: boolean;
  // 不被压缩（页头、动作排这类固定项）。
  fixed?: boolean;
  // 窄列宽度（对话消息那一列）。
  narrow?: boolean;
  // 贴右：把这一项推到行尾。
  push?: boolean;
  // 列表（配 `as="ul"`）：去掉列表标记与内距。
  plain?: boolean;
  // 内距档；缺省不留内距。
  pad?: LayoutPad;
}

export const Row = forwardRef<HTMLElement, RowProps>(function Row({
  as: Element = "div",
  gap,
  align,
  justify,
  wrap = false,
  grow = false,
  boxed = false,
  fixed = false,
  narrow = false,
  push = false,
  plain = false,
  pad,
  className,
  children,
  ...rest
}, ref): ReactNode {
  return (
    <Element
      ref={ref}
      className={classes(
        css.row,
        gapClass(css, gap),
        alignClass(css, align),
        justifyClass(css, justify),
        padClass(css, pad),
        wrap ? css.wrap : undefined,
        grow ? css.grow : undefined,
        boxed ? css.boxed : undefined,
        fixed ? css.fixed : undefined,
        narrow ? css.narrow : undefined,
        push ? css.push : undefined,
        boxed ? css.boxed : undefined,
        fixed ? css.fixed : undefined,
        plain ? css.plain : undefined,
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
});

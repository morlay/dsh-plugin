// `Stack`：纵向列 + 间距档。设置面上绝大多数区块都是它（页根、分组、字段列），
// 间距只从档位里选，页面不写数值。

import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { classes } from "../controls/classes.ts";
import css from "./layout.module.css";
import {
  alignClass,
  gapClass,
  padClass,
  type LayoutAlign,
  type LayoutGap,
  type LayoutPad,
} from "./scales.ts";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  // 渲染成哪个元素（区块用 `section`、列表用 `ul`、行内用 `span`）。
  as?: ElementType;
  // 子项之间的纵向间距。
  gap?: LayoutGap;
  // 交叉轴对齐；缺省 `stretch`（子项撑满整列）。
  align?: LayoutAlign;
  // 内距档；缺省不留内距。
  pad?: LayoutPad;
  // 撑开：吃掉剩下的宽度并允许收缩。
  grow?: boolean;
  // 卡片底座（边框 + 圆角 + 底色）。
  boxed?: boolean;
  // 不被压缩（页头、动作排这类固定项）。
  fixed?: boolean;
  // 窄列宽度（对话消息那一列）。
  narrow?: boolean;
  // 占满：页面根（宽高撑满、自己不滚）。
  fill?: boolean;
  // 滚动区：吃掉剩下的高度，内容长了它自己滚。
  scroll?: boolean;
  // 列表（配 `as="ul"`）：去掉列表标记与内距。
  plain?: boolean;
}

export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  {
    as: Element = "div",
    gap,
    align,
    pad,
    grow = false,
    boxed = false,
    fixed = false,
    narrow = false,
    fill = false,
    scroll = false,
    plain = false,
    className,
    children,
    ...rest
  },
  ref,
): ReactNode {
  return (
    <Element
      ref={ref}
      className={classes(
        css.stack,
        gapClass(css, gap),
        alignClass(css, align),
        padClass(css, pad),
        grow ? css.grow : undefined,
        boxed ? css.boxed : undefined,
        fixed ? css.fixed : undefined,
        narrow ? css.narrow : undefined,
        fill ? css.fill : undefined,
        scroll ? css.scroll : undefined,
        plain ? css.plain : undefined,
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
});

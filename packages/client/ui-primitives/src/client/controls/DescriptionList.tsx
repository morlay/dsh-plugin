// 定义列表（两列：名称 / 值）：`dt` 用三级文本色、`dd` 右对齐并用二级色与等宽数字。
// 调用方直接写 `<dt>` / `<dd>` 子元素，列的几何归这里。

import type { HTMLAttributes, ReactNode } from "react";
import { classes } from "./classes.ts";
import css from "./DescriptionList.module.css";

export type DescriptionListProps = HTMLAttributes<HTMLDListElement>;

export function DescriptionList({ className, children, ...rest }: DescriptionListProps): ReactNode {
  return (
    <dl className={classes(css.list, className)} {...rest}>
      {children}
    </dl>
  );
}

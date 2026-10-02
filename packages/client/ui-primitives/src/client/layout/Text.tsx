// `Text`：文本档位（字号 / 颜色 / 字重 / 等宽 / 截断）。设置面上的标题、说明、摘要、诊断行都从这里选档，
// 页面不写字号与颜色。

import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { classes } from "../controls/classes.ts";
import css from "./layout.module.css";
import { sizeClass, toneClass, weightClass, type TextSize, type TextTone, type TextWeight } from "./scales.ts";

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "color"> {
  // 渲染成哪个元素（标题用 `h4`、说明用 `p`、行内摘要用 `span`）。
  as?: ElementType;
  // 字号档；缺省继承。
  size?: TextSize;
  // 颜色档；缺省继承。
  tone?: TextTone;
  // 字重档（区块标题那一档）。
  weight?: TextWeight;
  // 等宽（诊断行、配置值那类文本）。
  mono?: boolean;
  // 一行放不下就省略号截断。
  truncate?: boolean;
  // 数字等宽（计数、分页这类会跳动的数值）。
  tabular?: boolean;
  children?: ReactNode;
}

export function Text({
  as: Element = "span",
  size,
  tone,
  weight,
  mono = false,
  truncate = false,
  tabular = false,
  className,
  children,
}: TextProps): ReactNode {
  return (
    <Element
      className={classes(
        css.text,
        sizeClass(css, size),
        toneClass(css, tone),
        weightClass(css, weight),
        mono ? css.mono : undefined,
        truncate ? css.truncate : undefined,
        tabular ? css.tabular : undefined,
        className,
      )}
    >
      {children}
    </Element>
  );
}

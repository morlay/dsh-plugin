// 座位按钮：工具行里的一个"座位"——图标 + 文本（+ 可展开的箭头），胶囊形，展开时保持底色。
// composer 里的模式座位、以及任何"点开是一份清单"的行内入口都用它。

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classes } from "./classes.ts";
import css from "./SeatButton.module.css";

export interface SeatButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  // 座位上的图标（16px 那一档）。
  icon: ReactNode;
  // 座位上的文本；放不下就以省略号收窄。
  label: string;
  // 展开态：菜单开着时保持底色（与 `aria-expanded` 同一件事，这里只管观感）。
  expanded?: boolean;
  // 尾部箭头（可展开的座位给）。
  chevron?: ReactNode;
}

export function SeatButton({
  icon,
  label,
  expanded = false,
  chevron,
  type = "button",
  className,
  ...rest
}: SeatButtonProps): ReactNode {
  return (
    <button
      type={type}
      className={classes(css.seat, expanded ? css.expanded : undefined, className)}
      {...rest}
    >
      <span className={css.icon}>{icon}</span>
      <span className={css.label}>{label}</span>
      {chevron === undefined ? null : <span className={css.chevron}>{chevron}</span>}
    </button>
  );
}

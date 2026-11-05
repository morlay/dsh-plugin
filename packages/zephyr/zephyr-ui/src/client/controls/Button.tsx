// 按钮：官方 `Button` + 两条本包统一的修饰——**文字不换行**（按钮宽度由内容定，短词被折成两行只是没必要的
// 换行）、`tone="danger"` 时把填充换成错误色（危险动作的配色只在这里出现，入口保持中性）。
// 业务从本包取到的就是这个包装版（`../index.ts` 里显式导出它，覆盖官方同名的那份）。

import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { Button as OfficialButton } from "@deepseek-ai/dsh-client-ui-primitives";
import { classes } from "./classes.ts";
import css from "./Button.module.css";

export type ButtonTone = "danger";

export type ButtonProps = ComponentProps<typeof OfficialButton> & {
  // 配色档：缺省用官方那套；`danger` 换成错误色。
  tone?: ButtonTone;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, tone, ...rest },
  ref,
): ReactNode {
  return (
    <OfficialButton
      ref={ref}
      data-role="button"
      className={classes(className, css.label, tone === "danger" ? css.danger : undefined)}
      {...rest}
    />
  );
});

// 按钮：官方 `Button` + 一条本包统一的修饰——**文字不换行**（按钮宽度由内容定，短词被折成两行只是没必要的换行）。
// 业务从本包取到的就是这个包装版（`../index.ts` 里显式导出它，覆盖官方同名的那份）。

import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { Button as OfficialButton } from "@deepseek-ai/dsh-client-ui-primitives";
import { styling } from "../styling/styling.ts";
import { styles } from "./controls.styles.ts";

export type ButtonProps = ComponentProps<typeof OfficialButton>;

const nowrap = styling.className(styles.buttonLabel);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, ...rest },
  ref,
): ReactNode {
  return (
    <OfficialButton
      ref={ref}
      data-role="button"
      className={className === undefined || className === "" ? nowrap : `${className} ${nowrap}`}
      {...rest}
    />
  );
});

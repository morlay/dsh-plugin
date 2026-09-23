// 样式搬自 vendor/deepseek-harness/packages/client/ui-primitives/src/settings-form/SettingsForm.module.css，
// 换成包内 css-in-js（CSSProps + dsw）；上游那份是 CSS Modules，本包不做预编译。

import type { CSSProps } from "../styling/css.ts";
import { dsw } from "../theme.ts";

// 上游引用的 --dsw-alias-label-error 不在官方主题定义集内（token 树里没有这个变量），
// 照抄引用而不是换一个近义 token——官方主题哪天定义它，这里自动跟着生效。
const failedColor = "var(--dsw-alias-label-error)";

export const styles = {
  form: {
    display: "flex",
    flexDirection: "column",
  },
  // 上游 readOnly 与 unavailable 同一条规则：两处用同一个样式对象。
  notice: {
    margin: "0 0 12px",
    fontSize: "12px",
    lineHeight: 1.5,
    color: dsw.alias.label.tertiary,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingTop: "16px",
  },
  failed: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.5,
    color: failedColor,
  },
  save: {
    appearance: "none",
    border: "1px solid transparent",
    borderRadius: "8px",
    padding: "5px 14px",
    font: "inherit",
    fontSize: "13px",
    lineHeight: 1.5,
    cursor: "pointer",
    background: dsw.alias.label.primary,
    color: dsw.alias.bg.layer["3"],
    "&:disabled": {
      opacity: 0.4,
      cursor: "default",
    },
    "&:focus-visible": {
      outline: `2px solid ${String(dsw.alias.brand.primary)}`,
      outlineOffset: "1px",
    },
  },
} satisfies Record<string, CSSProps>;

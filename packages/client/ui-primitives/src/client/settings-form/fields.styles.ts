// 样式搬自 vendor/deepseek-harness/packages/client/ui-primitives/src/settings-form/fields.module.css，
// 换成包内 css-in-js（CSSProps + dsw）；上游那份是 CSS Modules，本包不做预编译。

import type { CSSProps } from "../styling/css.ts";
import { dsw } from "../theme.ts";

// 上游引用的 --dsw-alias-bg-layer-4 不在官方主题定义集内（token 树里没有这个变量），
// 照抄引用而不是换一个近义 token——官方主题哪天定义它，这里自动跟着生效。
const helpButtonHoverBackground = "var(--dsw-alias-bg-layer-4)";

export const styles = {
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px 0",
    "& + &": {
      borderTop: `0.5px solid ${String(dsw.alias.border.l2)}`,
    },
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: "13px",
    fontWeight: 500,
    lineHeight: 1.5,
    color: dsw.alias.label.primary,
  },
  // 标签进 labelGroup 后由外层承担伸缩，自己不再抢空间（上游的 `.labelGroup > .label`）。
  groupLabel: {
    flex: "0 1 auto",
  },
  labelGroup: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flex: 1,
    minWidth: 0,
  },
  helpButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: "24px",
    height: "24px",
    padding: 0,
    border: 0,
    borderRadius: "6px",
    background: "none",
    color: dsw.alias.label.tertiary,
    cursor: "pointer",
    "&:hover": {
      background: helpButtonHoverBackground,
      color: dsw.alias.label.secondary,
    },
    "&[aria-expanded='true']": {
      background: helpButtonHoverBackground,
      color: dsw.alias.label.secondary,
    },
    "&:focus-visible": {
      outline: `2px solid ${String(dsw.alias.brand.primary)}`,
      outlineOffset: "1px",
    },
  },
  help: {
    padding: "10px 0 0",
    fontSize: "12px",
    lineHeight: 1.6,
    color: dsw.alias.label.secondary,
    "& > p": {
      margin: 0,
    },
    "& > p + p": {
      marginTop: "8px",
    },
  },
  badges: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  },
  // 上游用 Tag（tone="neutral" | "quiet"）：这里按变体拆两个 styled，形态与颜色照抄 Tag.module.css。
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    cornerShape: "round",
    padding: "1px 8px",
    fontSize: "11px",
    lineHeight: "17px",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  badgeNeutral: {
    background: dsw.alias.bg.module.platform,
    color: dsw.alias.label.secondary,
  },
  badgeQuiet: {
    color: dsw.alias.label.tertiary,
  },
  reset: {
    border: "none",
    background: "none",
    padding: 0,
    font: "inherit",
    fontSize: "12px",
    lineHeight: 1.5,
    color: dsw.alias.label.secondary,
    cursor: "pointer",
    "&:hover:not(:disabled)": {
      color: dsw.alias.label.primary,
    },
    "&:disabled": {
      cursor: "default",
    },
  },
  input: {
    height: "34px",
    padding: "0 12px",
    border: `0.5px solid ${String(dsw.alias.border.l4)}`,
    borderRadius: "8px",
    background: dsw.alias.bg.layer["3"],
    font: "inherit",
    fontSize: "13px",
    lineHeight: 1.5,
    color: dsw.alias.label.primary,
    "&:focus-visible": {
      outline: "none",
      borderColor: dsw.alias.brand.primary,
    },
    "&:disabled": {
      color: dsw.alias.label.tertiary,
      cursor: "default",
    },
    "&[aria-invalid='true']": {
      borderColor: dsw.alias.state.error.primary,
    },
  },
  invalid: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.5,
    color: dsw.alias.state.error.primary,
  },
  hint: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.5,
    color: dsw.alias.label.tertiary,
  },
} satisfies Record<string, CSSProps>;

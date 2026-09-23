/**
 * 「子代理」卡片限额段的样式表（官方 `--dsw-*` 变量 + 我们的 css-in-js 层）。
 *
 * 只有布局，没有外观：外观交给共享的 `SettingsForm` / `SettingsValueField` 原语。
 */

import type { CSSProps } from "@morlay/dsh-client-ui-primitives/client";

/** 卡片里那一段的样式。 */
export const styles = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  heading: {
    margin: "0",
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "600",
    color: "var(--dsw-alias-label-primary)",
  },
  // 两个限额并排；窄到放不下时各自占一行（上游也是两列）。
  limits: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "16px",
  },
} satisfies Record<string, CSSProps>;

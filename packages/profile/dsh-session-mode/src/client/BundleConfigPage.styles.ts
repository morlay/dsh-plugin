// bundle 配置页的样式：布局与容器归这里，控件本身一律用官方 primitives（`SettingsValueField` / `Checkbox` /
// `SegmentedControl` / `Menu` / `Input` / `Tag` / `Button`）——视觉与上游设置面同一套。
//
// 唯一自造外观的是多行文本：官方通用表单只有单行 `SettingsValueField`，而 persona 是多行文本。它按官方输入框的
// token 画（边框 / 圆角 / 字号 / 内距），不再另立一套。

import { styling, type CSSProps } from "@morlay/dsh-client-ui-primitives/client";

export const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  sectionTitle: {
    margin: "0",
    fontSize: "13px",
    lineHeight: "20px",
    fontWeight: "600",
    color: "var(--dsw-alias-label-primary)",
  },
  hint: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  invalid: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-state-error-primary)",
  },
  // 多行文本：官方表单没有这个控件，按官方输入框（`fields.module.css` 的 `.input`）的数值画。
  multiline: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "64px",
    padding: "6px 12px",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-layer-3)",
    border: "0.5px solid var(--dsw-alias-border-l4)",
    borderRadius: "var(--dsw-radius-md)",
    resize: "vertical",
  },
  modeCard: {
    display: "flex",
    flexDirection: "column",
    padding: "4px 12px 8px",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: "10px",
    background: "var(--dsw-alias-bg-base)",
    flex: "none",
  },
  // 折叠行的文本容器：在行里撑开（否则右侧那一组贴不到最右）。
  disclosureRoot: {
    flex: "1 1 auto",
    minWidth: "0",
  },
  // 折叠行内部：标题与右侧的摘要/删除在同一行，右侧那一组贴最右。
  disclosureContent: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minWidth: "0",
  },
  modeHeadAside: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    marginLeft: "auto",
    flex: "none",
  },
  modeSummary: {
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  modeId: {
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--dsw-alias-label-tertiary)",
  },
  modeBody: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "8px 0 4px",
  },
  // 受保护的模式在头部给一句说明（与删除按钮同一个位置）。
  protectedNote: {
    fontSize: "12px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-tertiary)",
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "0",
  },
  groupHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  groupTitle: {
    fontSize: "12px",
    lineHeight: "18px",
    fontWeight: "600",
    color: "var(--dsw-alias-label-secondary)",
  },
  // 字段容器：只负责分隔线与留白口径。文本字段用官方 `SettingsValueField`（它自带 `padding: 12px 0`），
  // 其余字段的内层用 `fieldBody` 给同样的 12px —— 两种字段在页面上因此上下留白与分隔完全一致。
  field: {
    display: "flex",
    flexDirection: "column",
  },
  fieldDivider: {
    borderTop: "0.5px solid var(--dsw-alias-border-l2)",
  },
  fieldBody: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px 0",
  },
  // 开关 / 三态 / 多选按钮这一类"右侧控件"的字段：标签与说明在左，控件贴最右。
  fieldInline: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "12px 0",
  },
  fieldText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: "0",
  },
  // 标签与说明的数值取自官方 `fields.module.css`（`.label` 13px/wt500、`.hint` 12px/tertiary）。
  fieldLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-primary)",
  },
  fieldHint: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-tertiary)",
  },
  roles: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
  },
  // 标签输入：与官方输入框同一种边框/背景，标签与内联输入都在框内，放不下就换行。
  chips: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "4px 6px",
    boxSizing: "border-box",
    width: "100%",
    minHeight: "32px",
    padding: "4px 8px",
    background: "var(--dsw-alias-bg-layer-3)",
    border: "0.5px solid var(--dsw-alias-border-l4)",
    borderRadius: "var(--dsw-radius-md)",
  },
  // 与官方输入框同高（`Input.module.css` 的 32px）：同行摆的控件高度必须一致。
  controlHeight: {
    height: "32px",
  },
  // 框内的裸输入：边框与背景都交给外面那个框。
  chipInput: {
    flex: "1 1 120px",
    minWidth: "120px",
    padding: "2px 0",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-primary)",
    background: "transparent",
    border: "none",
    outline: "none",
  },
  // 可移除的胶囊：几何与配色照官方 `Tag` 的 neutral（999px 圆角、11px/17px、wt500、
  // `bg-module-platform` + 二级文本色），只是里面多一个"移除"按钮——官方 Tag 是只读的，嵌不进按钮。
  tagChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    padding: "1px 4px 1px 8px",
    borderRadius: "999px",
    cornerShape: "round",
    fontSize: "11px",
    lineHeight: "17px",
    fontWeight: "500",
    whiteSpace: "nowrap",
    color: "var(--dsw-alias-label-secondary)",
    background: "var(--dsw-alias-bg-module-platform)",
  },
  tagRemove: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    padding: "0",
    color: "var(--dsw-alias-label-tertiary)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    lineHeight: "1",
  },
  // 框 + 候选按钮一行。
  tagRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    width: "100%",
  },
  // 卡片头的删除入口：官方 `Button` 的 `ghost` 变体（无边框、hover 才上底色）配上侧边栏那种方形图标按钮的几何
  // ——28×28、`padding: 0`、次级文本色。
  iconAction: {
    width: "28px",
    height: "28px",
    padding: "0",
    color: "var(--dsw-alias-label-secondary)",
  },
  // 危险动作的配色只在确认那一刻出现：确认按钮把 primary 的填充换成错误色。
  dangerFill: {
    "--dsw-alias-button-primary-fill": "var(--dsw-alias-state-error-primary)",
  },
  // 诊断行：异常态才出现，等宽小字。
  diagnosis: {
    margin: "0",
    fontFamily: "monospace",
    fontSize: "11px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-tertiary)",
    wordBreak: "break-all",
  },
  addRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  addInput: {
    width: "200px",
    flex: "0 0 auto",
  },
  // 默认模式这一行是左右布局：左侧标签与说明，右侧选择器。
  defaultRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  defaultText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "12px 0",
    minWidth: "0",
  },
} satisfies Record<string, CSSProps>;

export const props = styling.props;

export const className = styling.className;

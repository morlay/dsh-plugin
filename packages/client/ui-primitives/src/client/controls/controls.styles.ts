// 设置面通用控件的样式：数值与配色一律读官方 `--dsw-*` 语义 token（与上游设置面同一套）。
// 这里只放**控件本身**的样式；页面的结构布局归消费方（业务包）。

import { focusRing } from "../styling/focus.ts";
import type { CSSProps } from "../styling/css.ts";
import { dsw } from "../theme.ts";

export const styles = {
  // 方形图标按钮：没有文字、没有边框，hover 才上底色（官方侧边栏那种 28×28 几何）。
  iconButton: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: "28px",
    height: "28px",
    padding: "0",
    color: dsw.alias.label.secondary,
    background: "transparent",
    border: "none",
    borderRadius: dsw.radius.sm,
    cursor: "pointer",
    "&:hover:not(:disabled)": {
      background: dsw.alias.interactive.bg.hover,
    },
    "&:disabled": {
      cursor: "not-allowed",
      opacity: "0.4",
    },
    "&:focus-visible": {
      outline: focusRing,
      outlineOffset: "-2px",
    },
  },
  // 多行文本：官方通用表单只有单行，这个按官方输入框的数值画（边框 / 圆角 / 字号 / 内距）。
  multiline: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "64px",
    padding: "6px 12px",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: dsw.alias.label.primary,
    background: dsw.alias.bg.layer["3"],
    border: `0.5px solid ${String(dsw.alias.border.l4)}`,
    borderRadius: dsw.radius.md,
    resize: "vertical",
    "&:disabled": {
      cursor: "not-allowed",
      opacity: "0.4",
    },
    "&:focus-visible": {
      outline: focusRing,
      outlineOffset: "-2px",
    },
  },
  // 标签输入的框：与官方输入框同一种边框 / 背景 / 高度，标签与内联输入都在框里，放不下就换行。
  chipsBox: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "4px 6px",
    width: "100%",
    minHeight: "32px",
    padding: "4px 8px",
    background: dsw.alias.bg.layer["3"],
    border: `0.5px solid ${String(dsw.alias.border.l4)}`,
    borderRadius: dsw.radius.md,
  },
  // 框内的裸输入：边框、背景与焦点环都交给外面那个框。
  chipInput: {
    flex: "1 1 120px",
    minWidth: "120px",
    padding: "2px 0",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: dsw.alias.label.primary,
    background: "transparent",
    border: "none",
    outline: "none",
  },
  // 可移除的胶囊：几何与配色照官方 `Tag` 的 neutral（999px 圆角、11px/17px、wt500、
  // `bg-module-platform` + 二级文本色），只是里面多一个"移除"按钮——官方 `Tag` 是只读的，嵌不进按钮。
  chip: {
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
    color: dsw.alias.label.secondary,
    background: dsw.alias.bg.module.platform,
  },
  // 胶囊里的移除按钮：图标本身很小，给它一块贴着字号的点击区，不给可见的边框与背景。
  chipRemove: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: "14px",
    height: "14px",
    padding: "0",
    color: dsw.alias.label.tertiary,
    background: "transparent",
    border: "none",
    borderRadius: "999px",
    cursor: "pointer",
    lineHeight: "1",
    "&:hover:not(:disabled)": {
      color: dsw.alias.label.primary,
      background: dsw.alias.interactive.bg.hover,
    },
    "&:disabled": {
      cursor: "not-allowed",
      opacity: "0.4",
    },
    "&:focus-visible": {
      outline: focusRing,
      outlineOffset: "0px",
    },
  },
  // 标签输入与它右边的候选菜单：一行，顶部对齐（框会随标签换行变高）。
  tagRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    width: "100%",
  },
  // 与官方输入框同高（`Input.module.css` 的 32px）：同行摆的控件高度必须一致。
  controlHeight: {
    height: "32px",
  },
  // 按钮文字不换行：按钮宽度由内容定，"添加"这类短词被折成两行只是没必要的换行。
  buttonLabel: {
    whiteSpace: "nowrap",
  },
  // 可搜索选择器里那一行搜索框：夹在菜单顶部，与候选行同一个内距尺度。
  searchRow: {
    display: "flex",
    alignItems: "center",
    padding: "4px 8px 8px",
    borderBottom: `0.5px solid ${String(dsw.alias.border.l2)}`,
  },
  searchInput: {
    width: "100%",
    padding: "2px 0",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1.5",
    color: dsw.alias.label.primary,
    background: "transparent",
    border: "none",
    outline: "none",
  },
  // 一个候选都没匹配上：在候选区里说一句，而不是给一张空菜单。
  searchEmpty: {
    margin: "0",
    padding: "8px",
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.label.tertiary,
  },
  // 模型路由清单（`ModelRouteList`）：分组铺开、只选一条。数值照官方"子智能体"那张卡的模型清单。
  routeList: {
    display: "grid",
    gap: "6px",
    minWidth: "0",
    maxHeight: "280px",
    margin: "0",
    padding: "10px",
    overflow: "auto",
    border: `0.5px solid ${String(dsw.alias.border.l4)}`,
    borderRadius: dsw.radius.lg,
  },
  routeGroup: {
    display: "grid",
    gap: "6px",
    "& + &": {
      marginTop: "4px",
      paddingTop: "10px",
      borderTop: `0.5px solid ${String(dsw.alias.border.l3)}`,
    },
  },
  routeProvider: {
    padding: "0 6px",
    fontSize: "11px",
    fontWeight: 500,
    color: dsw.alias.label.tertiary,
  },
  routeItem: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "center",
    gap: "8px",
    minWidth: "0",
    padding: "6px",
    borderRadius: dsw.radius.md,
    cursor: "pointer",
    "&:hover": {
      // 上游那张卡的 hover 底色引用了 `--dsw-alias-bg-layer-4`：它不在官方 token 集里，照抄引用而不是换一个近义 token。
      background: "var(--dsw-alias-bg-layer-4)",
    },
    "&:focus-visible": {
      outline: focusRing,
      outlineOffset: "-2px",
    },
  },
  // 选中的那一条：底色 + 勾（勾由组件画）。
  routeItemPicked: {
    background: dsw.alias.interactive.bg.hover,
  },
  routeText: {
    minWidth: "0",
  },
  routeName: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "13px",
    color: dsw.alias.label.primary,
  },
  routeId: {
    display: "block",
    marginTop: "2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "11px",
    color: dsw.alias.label.tertiary,
  },
  // 清单的状态行（读目录中 / 失败 / 一条都没有）。
  routeNotice: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.label.tertiary,
  },
  routeError: {
    margin: "0",
    fontSize: "12px",
    lineHeight: "1.5",
    color: dsw.alias.state.error.primary,
  },
} satisfies Record<string, CSSProps>;

/**
 * 行式编辑器的样式：等宽、行号、语法色、悬停行为——全部消费官方 `--dsw-*` token。
 *
 * 几何只有一套：行高、行内间距、动作按钮尺寸都由下面几个常量给，行与行之间不各自决定。
 */

import { styled } from "@morlay/dsh-client-ui-primitives/client";
import { dsw } from "@morlay/dsh-client-ui-primitives/client";

/** 等宽字体栈：配置值的观感与代码一致。 */
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** 行高：行内容、行内输入、折叠箭头、按钮排都在这一档上对齐。 */
const ROW = "22px";

/** 行内元素之间的间距。 */
const GAP = "6px";

/** 动作按钮：方形图标键，尺寸与行高同一档的紧凑版。 */
const ACTION = "20px";

/** 动作按钮之间的间距（比行内间距紧一档）。 */
const ACTION_GAP = "4px";

/** 图标边长（行内图标与动作键同一档）。 */
export const ICON_SIZE = 14;

/** 折叠列（chevron 与它的占位）宽度。 */
const FOLD = "14px";

/** 行号列宽度。 */
const NUMBER = "32px";

/** 行尾留白。 */
const PAD = "8px";

/** 细线：theme 给的 0.5px 描边（`0 0 0 0.5px var(--dsw-elevation-stroke-color)`）。 */
const HAIRLINE = dsw.elevation.stroke;

/** 描边色：theme 里给描边用的那一档（与官方 `Menu` 面板同源）。 */
const LINE = dsw.elevation.stroke.color;

/** 行左侧那道「改过」的标记宽度。 */
const EDGE = "2px";

/** 编辑器的根：纵向排列的行。 */
export const EditorRoot = styled("div")({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  fontFamily: MONO,
  fontSize: "14px",
  lineHeight: ROW,
  color: dsw.alias.label.primary,
});

/** 一行：行号 + 折进 + 行内容。悬停给一层浅底。 */
export const LineRow = styled("div")({
  display: "flex",
  // 顶部对齐：行里出现输入框或多行值时，内容不跟着上下跳。
  alignItems: "flex-start",
  gap: GAP,
  minHeight: ROW,
  paddingRight: PAD,
  whiteSpace: "nowrap",
  "&:hover": { background: dsw.alias.bg.layer["2"] },
  // 选中一行（点行号）：整行留一层底色，便于对着行号找内容。
  "&[data-selected='true']": { background: dsw.alias.bg.layer["3"] },
  // 本页改过还没保存：左边一道强调色，和「已经存进用户层」的浅灰区分开。
  "&[data-dirty='true']": { boxShadow: `inset ${EDGE} 0 0 ${String(dsw.alias.brand.primary)}` },
  "&[data-overridden='true']": { boxShadow: `inset ${EDGE} 0 0 ${String(LINE)}` },
  // 有问题的行只留一道红条 + 注释位的红字：整行铺红太吵。
  "&[data-invalid='true']": {
    boxShadow: `inset ${EDGE} 0 0 ${String(dsw.alias.state.error.primary)}`,
  },
  // 行内的行为按钮（撤回 / 恢复默认 / 复制 / 移除）：平时透明，悬停这一行才显形。
  "&:hover [data-role='actions']": { opacity: 1 },
});

/** 一行的内容区：**缩进只作用在这里**——行号列固定在左边，缩进不推它。 */
export const LineBody = styled("div")({
  display: "flex",
  alignItems: "center",
  gap: GAP,
  flex: 1,
  minWidth: 0,
  minHeight: ROW,
});

/** 行号列：右对齐、不可选、淡色。 */
export const LineNumber = styled("span")({
  flex: "none",
  width: NUMBER,
  lineHeight: ROW,
  textAlign: "right",
  color: dsw.alias.label.caption,
  userSelect: "none",
  cursor: "pointer",
});

/** 折叠 chevron（官方箭头图标，尺寸与别的行内图标同源）。 */
export const LineFold = styled("button")({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  width: FOLD,
  height: ROW,
  padding: 0,
  border: 0,
  background: "none",
  color: dsw.alias.label.caption,
  cursor: "pointer",
  "&:hover": { color: dsw.alias.label.secondary },
});

/** 叶子行的折叠占位（保持列对齐）。 */
export const LineFoldSpacer = styled("span")({
  flex: "none",
  width: FOLD,
});

/** 键名（配置键原样；数组下标淡一些）。 */
export const LineKey = styled("span")({
  flex: "none",
  color: dsw.alias.label.primary,
  "&[data-index='true']": { color: dsw.alias.label.caption },
});

/** 结构符与标点（`{` `}` `[` `]` `:`）。 */
export const LineToken = styled("span")({
  flex: "none",
  color: dsw.alias.label.caption,
});

/** 值（token）：字符串 / 数字 / 布尔各有语法色。 */
export const LineValue = styled("span")({
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  cursor: "text",
  color: dsw.alias.state.business.primary,
  "&[data-tone='number']": { color: dsw.alias.state.warn.primary },
  "&[data-tone='boolean']": { color: dsw.alias.state.success.primary },
  "&[data-tone='empty']": { color: dsw.alias.label.caption },
});

/**
 * 值上的下拉触发：**它自己就是值的呈现**（不再是「值 + 一个下拉」两遍），点开才出菜单。
 */
export const ValueTrigger = styled("button")({
  display: "inline-flex",
  alignItems: "center",
  gap: "2px",
  minWidth: 0,
  padding: 0,
  border: 0,
  background: "none",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  color: dsw.alias.label.caption,
  "&:disabled": { cursor: "default" },
  "&:focus-visible": { outline: "none" },
});

/**
 * 行内输入的外壳：官方 `Input` 压到与值同一行高，并**吃掉剩下的宽度**。
 *
 * 行内编辑与容器闭合行的添加输入共用它——两处的输入框因此长得一模一样。
 */
export const CompactInput = styled("span")({
  display: "inline-flex",
  flex: "1 1 auto",
  minWidth: 0,
  "& > span": {
    width: "100%",
    height: ROW,
    padding: "0 6px",
    borderRadius: "4px",
  },
  "& input": {
    fontSize: "14px",
    lineHeight: ROW,
  },
});

/**
 * 多行值的行内输入：官方没有多行原子，所以这里用同一套观感的字段壳（同边框、同圆角、同焦点色），
 * 高度跟着内容长、宽度同样撑满剩下的位置。
 */
export const CompactTextField = styled("span")({
  display: "inline-flex",
  flex: "1 1 auto",
  minWidth: 0,
  padding: "0 6px",
  borderRadius: "4px",
  background: dsw.alias.bg.layer["1"],
  // 细线走 theme 的描边（0.5px 与颜色都由 token 给）。
  border: 0,
  boxShadow: HAIRLINE,
  "&:focus-within": { "--dsw-elevation-stroke-color": dsw.alias.brand.primary },
  "& > textarea": {
    flex: 1,
    width: "100%",
    minHeight: ACTION,
    maxHeight: "240px",
    padding: 0,
    border: 0,
    outline: "none",
    background: "transparent",
    resize: "none",
    fieldSizing: "content",
    fontFamily: "inherit",
    fontSize: "14px",
    lineHeight: ROW,
    color: dsw.alias.label.primary,
  },
});

/** 行内注释（schema 说明与业务文案）：比配置值小一档，占满这一行剩下的宽度，长了就截断（hover 看全文）。 */
export const LineComment = styled("span")({
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: dsw.alias.label.tertiary,
  fontFamily: "inherit",
  fontSize: "12px",
});

/** 行内的校验消息（与注释放同一档字号）。 */
export const LineInvalid = styled("span")({
  flex: "none",
  color: dsw.alias.state.error.primary,
  fontFamily: "inherit",
  fontSize: "12px",
});

/** 行尾的动作组：方形图标键（默认透明，悬停时显形）。 */
export const LineActions = styled("span")({
  display: "inline-flex",
  alignItems: "center",
  gap: ACTION_GAP,
  flex: "none",
  opacity: 0,
  "& > button": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: ACTION,
    height: ACTION,
    padding: 0,
    border: 0,
    borderRadius: "4px",
    background: "none",
    color: dsw.alias.label.secondary,
    cursor: "pointer",
    "&:hover": { background: dsw.alias.bg.layer["3"], color: dsw.alias.label.primary },
    "&:disabled": { cursor: "not-allowed", color: dsw.alias.label.dimmed },
  },
});

/**
 * 悬停行时才显示这一行的动作按钮：显形规则写在行上（`[data-role='actions']`），组件只需要带这个属性。
 */
export const HoverActions = styled(LineActions)({
  /**
   * 编辑态的两个按钮常显，而且**要有底色与描边**：行底色上只有淡色图标是看不见的，
   * 所以这里给实体按钮（theme 的描边 + 一层底），确认用成功档、取消用中性档。
   */
  "&[data-editing='true']": {
    opacity: 1,
    gap: GAP,
    "& > button": {
      boxShadow: HAIRLINE,
      background: dsw.alias.bg.layer["1"],
      color: dsw.alias.label.primary,
      "&:first-of-type": { color: dsw.alias.state.success.primary },
    },
  },
});

/** 添加输入：**跟在容器的闭合括号同一行**（菜单锚在它上面），宽度吃掉剩下的位置。 */
export const AddWrap = styled("span")({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  gap: GAP,
  flex: "1 1 auto",
  minWidth: 0,
  marginLeft: GAP,
  "&[data-invalid='true'] input": { borderColor: dsw.alias.state.error.primary },
});

/** 一行说明（不可用 / 没有可生成项时用）。 */
export const Hint = styled("p")({
  margin: 0,
  fontSize: "12px",
  lineHeight: 1.5,
  color: dsw.alias.label.tertiary,
});

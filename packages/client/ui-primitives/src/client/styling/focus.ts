// 焦点环口径搬上游 ui-theme 的 `focus.css`：颜色读官方 `--dsw-focus-ring-color`
// （主题把它按输入模态解析成蓝，指针模态下置 transparent 抑制环），变量缺失时回退业务蓝；
// 宽度读官方的 `--dsw-focus-ring-width`。偏移与线宽的特例仍由各控件自己声明。
import { dsw } from "../theme.ts";
import { Token } from "./token.ts";

export const focusRing = `${String(dsw.focus.ring.width)} solid ${Token.collect(
  Token.fallbackVar(dsw.focus.ring.color, String(dsw.alias.state.business.primary)),
)}`;

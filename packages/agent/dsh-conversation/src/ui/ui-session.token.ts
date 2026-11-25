// `ui-session` 的服务令牌：跨行注入 `ctx.uiSession`（右侧面板、工作区等行都要读它）。
//
// home 在对话域的契约面（`@morlay/dsh-conversation/contract`）：行与令牌同一个 owner，
// 别的域按令牌注入，不重复拥有上游那个面。
export { UiSession } from "@morlay/dsh-conversation/contract";

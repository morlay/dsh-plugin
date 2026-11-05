// `ui-session` 的服务令牌：跨行注入 `ctx.uiSession`（右侧面板等行要读它）。
//
// 令牌的 home 在框架层：技能、模型选择这些域也要读它，放会话包会让它们反向依赖对话聚合层。
export { UiSession } from "@morlay/zephyr-app/client";

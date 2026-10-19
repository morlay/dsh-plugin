// agent 指令的包根：一行实现 + 它的装配模块。
//
// 这一行没有自有契约面：它挂在系统提示装配与会话投影上，消费方是上游 `systemPrompt` 那一侧。
export * from "./agent-instruction.service.ts";
export * from "./agent-instruction.provide.ts";

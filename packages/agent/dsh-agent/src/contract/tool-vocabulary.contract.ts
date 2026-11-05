// 工具面的**公共词汇**（上游 `@deepseek-ai/dsh-tools` / `dsh-agent`）：执行器接口与造工具的纯函数。
//
// 测试与消费方都要它们（`defineTool` 造定义、`ToolExecutor` 描述执行面、`ToolCallId` 铸调用身份）。
export { ToolCallId } from "@deepseek-ai/dsh-llm";
export { defineTool } from "@deepseek-ai/dsh-tools";
export type { ToolExecutor } from "@deepseek-ai/dsh-tools";
export { agentEvents } from "@deepseek-ai/dsh-agent";

// 子代理文案接管的装配函数：一行 Provider，装配面只调它。
import { provide } from "@morlay/zephyr";
import { SubagentGuidance } from "./subagent/subagent-guidance.service.ts";

export const provideSubagentGuidance = provide([SubagentGuidance]);

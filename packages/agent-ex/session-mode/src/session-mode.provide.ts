// 宿主半的装配函数：**headless 一行、wire 一行**，分两层。
//
// 顺序有语义：装配瀑布按注册顺序嵌套（先注册的是外层），通道在外层把非 `keep` 的 section 降级成 reminder。
// 收口要挡在它内层——它负责把"这个会话看不见的 section"（工具说明、MCP 指令、dropSections）先滤掉，
// 否则那些内容会被通道降级成 reminder 照样送出去。
import { provide } from "@morlay/zephyr";
import { provideContextAssembler } from "./context-assembler.provide.ts";
import { SessionModeDefault } from "./session-mode.service.ts";
import { SessionScopeDefault } from "./session-scope.service.ts";
import { SubagentGuidance } from "./subagent/subagent-guidance.service.ts";
import { SessionModeEndpointDefault } from "./server/session-mode-endpoint.service.ts";
import { ToolGuidance } from "./tool-guidance.service.ts";

/**
 * **headless 面**：通道 → 收口 → 工具说明 → 模式本体。
 *
 * 不含端点行（那是 wire，要 `remote-handlers`）；headless 的测试与纯宿主部署装这一份就够。
 */
export const provideSessionMode = provide([
  ...provideContextAssembler(),
  SessionScopeDefault,
  // 工具说明汉化：改的是工具定义对象本身（模型面由执行器的 describe() 读定义算出来）。
  ToolGuidance,
  SubagentGuidance,
  SessionModeDefault,
]);

/**
 * **wire 面**：端点行（`sessionMode/*`）。装配面要对外暴露 RPC 时才装它。
 */
export const provideSessionModeEndpoints = provide([SessionModeEndpointDefault]);

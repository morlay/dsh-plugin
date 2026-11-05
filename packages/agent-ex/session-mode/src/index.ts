// session-mode 的**包根**：契约 + 默认实现 + 它们依赖的纯函数与数据表。
//
// 规范：root 出「契约聚合 + 默认实现」（`dsh-workspace` / `dsh-skill` 同形）；装配函数在 `./server`
// （宿主半，只出服务相关的）与 `./ui`（浏览器半）；两端共用的形状与纯函数在 `./endpoint`。
export * from "./contract/index.ts";

// 默认实现：四个同进程端口。
export * from "./session-mode.service.ts";
export * from "./session-scope.service.ts";
export * from "./context-assembler.service.ts";
export * from "./tool-guidance.service.ts";
export * from "./subagent/subagent-guidance.service.ts";

// 默认实现依赖的纯函数与数据表：模式归一化、清单来源、persona、PTC 骨架、按步送达、覆盖规则文本。
export * from "./endpoint/mode-config.ts";
export * from "./endpoint/mode-config-rules.ts";
export * from "./endpoint/session-mode-shapes.ts";
export * from "./endpoint/tool-group-ref.ts";
export * from "./modes.ts";
export * from "./mode-sources.ts";
export * from "./mode-store.ts";
export * from "./persona.ts";
export * from "./per-agent.ts";
export * from "./defaults.ts";
export * from "./ptc-describe.ts";
export * from "./ptc-sdk.ts";
export * from "./reminder.ts";
export * from "./rules.ts";
export * from "./system-remainder.ts";
export * from "./session-mode.projection.ts";

// 工具分组表：汉化 + 用法正文的真源（`guidance/packs/**` 是数据，`groups.ts` 只做汇总与渲染）。
// 直接出 `groups.ts` / `tool-groups.ts`：`guidance/index.ts` 会连带出 `types.ts` 的 `ToolGuidance` **接口**，
// 与本包的 `ToolGuidance` **服务类**撞名。要那个接口的消费方从 `./guidance` 的子路径取。
export {
  SHORT_TOOL_DESCRIPTIONS,
  TOOLS_SDK_INTERFACE,
  TOOL_GROUPS,
  assertGroupsUnique,
  groupByKey,
  groupOfTool,
  groupTitleOf,
  renderToolKey,
  groupSkillBody,
  renderToolsDeclaration,
  skillNameOf,
} from "./guidance/groups.ts";
export type { GroupLine, ToolGroup } from "./guidance/groups.ts";
export * from "./guidance/tool-groups.ts";

// 子代理两处文案的接管：运行时上下文的 name / 正文与回报指引。
export * from "./subagent/delegation-context.ts";
export * from "./subagent/return-guidance.ts";

// 本包订阅的上游事件（`agent/*` / `system-prompt/assemble` / `tools/change`）：不是会话域事件，留本地。
export * as Events from "./events.ts";
// headless 装配面（通道 / 收口 / 工具说明 / 模式本体）：只装这些，不含 wire 端点。
export { provideSessionMode, provideSessionModeEndpoints } from "./session-mode.provide.ts";
export { ContextChannel, provideContextAssembler } from "./context-assembler.provide.ts";
export { provideSubagentGuidance } from "./subagent.provide.ts";

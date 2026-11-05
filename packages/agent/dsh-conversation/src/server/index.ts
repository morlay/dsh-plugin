// 会话 API 面的宿主行（`./server` 入口）。
//
// 为什么单独成包：这些行要 agent 域的能力（`AgentDirectory` / `Llmd` / `AgentDefaultModel`），
// 而 `dsh-agent` 又依赖 `dsh-session`——留在 `dsh-session` 里就成了会话域反向依赖 agent 域的环。
export {
  provideApiSession,
  ApiSessionControllerHost,
  FileReferenceServiceRow,
} from "./api-session.provide.ts";
export { provideSessionReference } from "./session-reference.provide.ts";
export { SessionReferenceDefault } from "./session-reference.service.ts";
// 会话端点那一面（原 `@morlay/dsh-session/server` 的 `provideSessionRemote`）：端点属对话域，随 ui 一起搬来。
export { provideSessionRemote } from "./session-remote.provide.ts";
// 本域宿主面的**聚合入口**（一个面一个装配函数）：数据面 + 引用解析 + 会话端点。
export { provideConversationServer } from "./conversation-server.provide.ts";
// `toolResults/watch` 的宿主行（上游 `ui-trajectory` 的 host 入口）：端点属对话域。
export { ToolResultsDefault } from "./tool-results.service.ts";
// `ui-open-in-app` 的 host 半：三条 HTTP 路由（浏览器那次「打开方式」是 HTTP 读，不是 remote 方法）。
export { OpenInAppHost, OpenInAppHostRow } from "./open-in-app.service.ts";

export { provideDeliverables } from "./deliverable.provide.ts";
export { provideSessionTitle } from "./session-title.provide.ts";
export { provideSessionTitleLlm } from "./first-prompt-llm.provide.ts";

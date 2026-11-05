// 会话 API 面的宿主行（`./server` 入口）。
//
// 为什么单独成包：这些行要 agent 域的能力（`AgentDirectory` / `Llmd` / `AgentDefaultModel`），
// 而 `dsh-agent` 又依赖 `dsh-session`——留在 `dsh-session` 里就成了会话域反向依赖 agent 域的环。
export { provideApiSession, ApiSessionControllerHost, FileReferenceServiceRow } from "./api-session.provide.ts";
export { provideSessionReference } from "./session-reference.provide.ts";
export { SessionReferenceDefault } from "./session-reference.service.ts";
export { ScheduleRow } from "./schedule.service.ts";

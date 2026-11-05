// 对话域的包根：**契约**（与 `./contract` 同一份）+ 本域的实现类。
export * from "./contract/index.ts";

// 上游 `skills` 组那个类归**会话域的包根**（本仓是 `@deepseek-ai/dsh-api-session-controller` 的唯一 owner）：
// 技能域的注册表行从这里取，不直连上游包。
export { SessionSkillCatalog } from "@deepseek-ai/dsh-api-session-controller";

// 两个**纯值**词汇也从包根出，不进 `./contract`：上游没有 client-safe 子路径，按值转出会给契约面
// 收一条到宿主根的运行时边，而契约面被 ui 引用（判据见 `.agents/designs`）。
// 消费方都是宿主侧（`better-session` 的标题折叠与 RDB storage takeover）。
export { foldSessionTitle } from "@deepseek-ai/dsh-session-title";

// 交付物与标题：它们不是独立域，属会话域的一部分（实现随包根导出）。
export * from "./deliverable.service.ts";
export * from "./session-title.service.ts";
export * from "./first-prompt-llm.service.ts";

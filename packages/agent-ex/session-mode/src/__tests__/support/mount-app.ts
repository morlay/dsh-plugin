// session-mode 的**测试装配入口**：一次 bootstrap，拿到真 cordis 根 ctx。
//
// `bootstrapApplication` 返回的 `App.ctx` 就是 cordis 根 ctx（`App` 的定义里写着 `ctx: CordisContext`），
// 所以 `ctx.plugin(...)` / `ctx.extend(...)` / `ctx.sessionProjections` 都是真的 cordis 语义——
// 上游的 `@deepseek-ai/dsh-scope`（`bindScopeParent` 里的 `ctx.plugin(scope)` + `fiber.ctx.extend(...)`）
// 因此能跑，不需要任何替身。
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { sessionModeTestProviders, type SessionModeTestOptions } from "./session-mode-providers.ts";
import type { TestContext } from "./context.ts";

/** 一次测试装配：`app` 用来卸载，`ctx` 直接当 cordis 根 ctx 用。 */
export interface SessionModeTestApp {
  readonly app: App;
  readonly ctx: TestContext;
}

/**
 * 装一份 session-mode 的 headless 测试装配。
 * @param options - 通道 / 工具说明 / 提示词的覆盖。
 * @returns `app`（卸载用）与 `ctx`（真 cordis 根 ctx）。
 */
export async function mountSessionModeApp(
  options: SessionModeTestOptions = {},
): Promise<SessionModeTestApp> {
  const app = await bootstrapApplication({
    providers: sessionModeTestProviders(options),
    timeoutMs: 30_000,
  } as never);
  return { app, ctx: app.ctx as unknown as TestContext };
}

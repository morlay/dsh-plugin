// 会话域的**最小装配 helper**：真 cordis ctx + 真 `SessionStore`（服务名 `sessions`）。
//
// 只做这一件事：下游 spec 不必各自 `new CordisContext()` + `new SessionStore(ctx)`。
// 它**不**装 apps 的清单、也不装 llm / tools / 端点行——那些是各自域的事（要就自己往这个 ctx 上挂）。
import { Context as CordisContext } from "@deepseek-ai/cordis/src/context.ts";
import { SessionStore } from "@deepseek-ai/dsh-session";
import type { Context } from "@morlay/zephyr";

/**
 * 测试用的会话 ctx：真 cordis `Context`，加上按上游注册名发布的那一个服务。
 *
 * 本仓禁止 `declare module`，所以成员在这里显式声明；`get` / `provide` 也一样——cordis 靠模块增强
 * 把它们挂到 Context 上，`vendor/**` 不进我们的 program 时读不到。
 */
export type SessionTestContext = Context & {
  readonly sessions: SessionStore;
  get(name: string, strict?: boolean): unknown;
  provide(name: string, value: unknown): () => void;
};

/**
 * 造一份最小会话装配。
 *
 * 用直接构造（`new SessionStore(ctx)` 在构造里注册 `sessions`）而不是 `ctx.plugin`：后者异步生效，
 * 而用例在下一行就要 `ctx.sessions.create(...)`。
 * @param options - `sessions: false` 给「会话存储由别人装」的场景（别人装了再装一次就是同名重复注册）。
 * @returns 带 `sessions` 的 cordis ctx。
 */
export function createSessionContext(
  options: { readonly sessions?: boolean } = {},
): SessionTestContext {
  const ctx = new CordisContext() as unknown as SessionTestContext;
  if (options.sessions !== false) new SessionStore(ctx as never);
  return ctx;
}

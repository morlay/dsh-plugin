// 本仓 `Context` → 上游 cordis `Context`：**唯一**的转换点。
//
// 两边运行期是同一个对象（zephyr 的 `Context` 就是 cordis `Context` 的扩展面）；类型上分家是因为本仓
// 这一层补了显式成员（`logger` / `root` / `reflect` / `get` …），在 `exactOptionalPropertyTypes` 下
// "补得更多"并不等于"可赋值"（同一个成员在两边一个可选、一个必有，就互不兼容）。
//
// 另一头是 **cordis 的 `Context`**（上游 `ClientSessions` 的构造与 `scopeOf` / `sessionOf` 的入参），
// 不是本包能改的形状：zephyr 的 `compat/to-cordis.ts` 与 `compat/from-cordis.ts` 对同一条边也各断言
// 一次。所以这是一处**边界桥**（白名单见 devkit 的 `audit/rules.ts`），不是"先断言让它过"。
import type { ClientSessions } from "@deepseek-ai/dsh-api-session-controller/src/client/sessions/service.ts";
import type { Context } from "@morlay/zephyr";

/** 上游要的那份 ctx 类型（`ClientSessions` 各方法入参的 cordis `Context`）。 */
export type UpstreamContext = Parameters<ClientSessions["scopeOf"]>[0];

/**
 * 本仓的 ctx 面换成上游 cordis `Context`。
 *
 * 现在只有一处需要它：装配时的**行 ctx**（本仓 `Context`）。契约的 `scopeOf` / `sessionOf` 入参已经是
 * 上游要的 cordis `Context`（签名照上游声明），不再过这座桥。运行期是同一个对象（zephyr 的 `Context`
 * 就是 cordis `Context` 的扩展面），所以交出的必须是它本身（不复制、不包装）。
 * @param ctx - 本仓的 ctx 面。
 * @returns 上游看到的同一个 ctx。
 */
export function asUpstreamContext(ctx: Context): UpstreamContext {
  return ctx as unknown as UpstreamContext;
}

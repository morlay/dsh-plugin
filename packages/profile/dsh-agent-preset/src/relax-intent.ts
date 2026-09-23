/**
 * 放宽 fs 的写 / 改 intent：**只有本插件所在 preset 的会话**免除「先读后改」策略。
 *
 * 上游 `fs-observation-policy` 是 event-only 插件（不注册服务），住在 host 层、对所有 preset 生效，
 * 而它在 `fs/write-intent` / `fs/edit-intent` 这两个 waterfall 上**不调用 `next()`**、独占决策槽
 * （见上游 `fs-observation-policy/src/index.ts` 的 "occupy the single decision slot"）。想按模式关掉
 * 它只有一条路：抢在它前面。本行用 `prepend` 站链首，先让它算完（它抛的拒绝也接住），再对属于本
 * preset 的 actor 丢弃结果——`intent` 为 `undefined` 就是「无条件编辑」（上游 bare default 的语义）。
 *
 * 归属判据走 scope：本行注册在 preset 子树，自己的 scope 就是该 preset 的 standing key，而 actor 的
 * agent scope 沿 parent 链必然经过它。事件派发本身没有 scope 过滤（`ctx.waterfall(...)` 不传 thisArg，
 * 见上游 `tool-fs/src/edit.ts`），所以这层判断只能写在这里，靠 `global` 或监听位置都做不到。
 *
 * 于是：官方 preset 照旧吃那层策略（它们的 scope 链上没有本插件的 key），本模式不吃。
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-fs";
import { scopeOf, scopeParentOf } from "@deepseek-ai/dsh-scope";

export const name = "fs-intent-relax";

export function apply(ctx: Context): void {
  const own = scopeOf(ctx);
  if (own === undefined) {
    throw new Error("fs-intent-relax must be mounted inside a preset scope");
  }

  const belongs = (actor: object | undefined): boolean => {
    const agent = (actor as { agent?: { ctx: Context } } | undefined)?.agent;
    if (agent === undefined) return false;
    for (let key = scopeOf(agent.ctx); key !== undefined; key = scopeParentOf(key)) {
      if (key === own) return true;
    }
    return false;
  };

  /** 本 preset 的会话：丢弃上游的 intent 与拒绝；其余会话原样交回。 */
  const relax = async <T>(
    actor: object | undefined,
    next: () => T | Promise<T>,
  ): Promise<T | undefined> => {
    const ours = belongs(actor);
    try {
      const upstream = await next();
      return ours ? undefined : upstream;
    } catch (error) {
      if (ours) return undefined;
      throw error;
    }
  };

  ctx.on("fs/write-intent", (_target, actor, next) => relax(actor, next), { prepend: true });
  ctx.on("fs/edit-intent", (_target, actor, next) => relax(actor, next), { prepend: true });
}

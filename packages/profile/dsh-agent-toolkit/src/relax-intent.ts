// 放宽 fs 的写 / 改 intent：**只有本插件所在 preset 的会话**免除上游「先读后改」策略——上游
// `fs-observation-policy` 在 host 平面对所有 preset 生效、且在 `fs/write-intent` / `fs/edit-intent` 上独占决策槽
// （不调 `next()`），所以只能 `prepend` 站链首、先让它算完再丢弃结果；归属判据走 scope 的 parent 链。
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

  // 本 preset 的会话：丢弃上游的 intent 与拒绝；其余会话原样交回。
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

// 装配计划（SRP：**只管「本次装配里会有哪些令牌」**）。
//
// `inject.optional()` 靠它区分两种「还没有」：
//   - 装配里**会**提供它，只是还没就位 → 等（与 `inject()` 同一口径）；
//   - 装配里**根本没有**它 → 立刻 `undefined`。
// 于是 optional 也不再看 provider 的先后。
import type { Context } from "@deepseek-ai/cordis";
import type { Token } from "./injection.ts";
import { getTokenName } from "./token-meta.ts";
import { tableOf } from "./service-table.ts";

/** 登记本次装配会 provide 自己实例的令牌（`bootstrapApplication` 在装配期调一次）。 */
export function bindPlannedTokens(ctx: Context, tokens: ReadonlySet<Token>): void {
  const table = tableOf(ctx);
  for (const token of tokens) {
    table.plannedTokens.add(token);
    table.plannedTokenNames.add(getTokenName(token));
  }
}

/** 这个令牌在本次装配的计划里吗（按身份，再按名字兜底）。 */
export function isPlannedToken(ctx: Context, token: Token): boolean {
  const table = tableOf(ctx);
  if (table.plannedTokens.has(token)) return true;
  return table.plannedTokenNames.has(getTokenName(token));
}

// 服务解析（SRP：**只管读**）。
//
// 三个入口各有明确语义，调用方按需要选一个，不必知道表里怎么存：
//   - `resolveService(ctx, token)`：按令牌身份取（最常用）；
//   - `resolveServiceByTokenName(ctx, name)`：同一份源码被两条解析路径载入时按令牌名兜底；
//   - `resolveServiceName(ctx, name)`：按宿主服务名取（`ctx.<name>` 那一侧）。
// 外加 multi 的读、名字视图、按实例类型找上游服务，以及它们的等待版。
import type { Context } from "@deepseek-ai/cordis";
import type { Token } from "./injection.ts";
import { getTokenName } from "./token-meta.ts";
import { tableOf, waitFor } from "./service-table.ts";

export function resolveService(ctx: Context, token: Token): unknown {
  return tableOf(ctx).tokens.get(token);
}

/**
 * 按令牌名在令牌表里找值：同一份源码被两条解析路径载入（symlink 与真实路径）时，
 * 类身份不同但令牌名一致——依赖解析与 `without` 同一口径。
 */
export function resolveServiceByTokenName(ctx: Context, name: string): unknown {
  for (const [token, value] of tableOf(ctx).tokens) {
    if (getTokenName(token) === name) return value;
  }
  return undefined;
}

export function resolveServiceName(ctx: Context, name: string): unknown {
  return tableOf(ctx).names.get(name);
}

export function resolveMulti(ctx: Context, token: Token): unknown[] {
  return tableOf(ctx).multi.get(token) ?? [];
}

export function isMultiToken(ctx: Context, token: Token): boolean {
  return tableOf(ctx).multi.has(token);
}

export function serviceNamesOf(ctx: Context): ReadonlyMap<string, unknown> {
  return tableOf(ctx).names;
}

/** 行 ctx 的服务表里按实例类型找服务（上游抽象 Service 类本身就是令牌）。 */
export function serviceInstanceOfType(
  ctx: Context,
  serviceClass: Function,
): { name: string; value: unknown } | undefined {
  const store = ctx.reflect.store as unknown as Record<
    PropertyKey,
    { name: string; value?: unknown }
  >;
  for (const key of Reflect.ownKeys(store)) {
    const impl = store[key];
    if (impl?.value instanceof serviceClass) return { name: impl.name, value: impl.value };
  }
  for (const [name, value] of serviceNamesOf(ctx)) {
    if (value instanceof serviceClass) return { name, value };
  }
  return undefined;
}

/** 等令牌就位（`inject()` 的等待版）。 */
export function awaitService(ctx: Context, token: Token): Promise<void> {
  return waitFor(ctx, token, resolveService(ctx, token));
}

/** 等名字就位（上游行按名字装载时的等待版）。 */
export function awaitServiceName(ctx: Context, name: string): Promise<void> {
  return waitFor(ctx, name, resolveServiceName(ctx, name));
}

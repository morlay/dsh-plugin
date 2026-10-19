// 清单合并（装配内部）：去重、`without` 剔除、计划令牌。
//
// 这一层不是接口：装配面只经 `bootstrapApplication({ providers })` 与 `provide(...)` / `configure(...)`
// 相遇（见 `provider.ts`）。清单怎么去重、`without` 标记怎么解，属于实现。
import { tryGetTokenMeta } from "./token-meta.ts";
import type { ProviderEntry, WithoutRef } from "./provider.ts";
import type { Token } from "./injection.ts";

function isWithoutRef(entry: ProviderEntry): entry is WithoutRef {
  return (
    typeof entry === "object" && entry !== null && (entry as { kind?: unknown }).kind === "without"
  );
}

/**
 * 条目身份：`providerBase`（`configure` 绑过配置的子类回溯到实现类）或条目自身。
 *
 * `without` 的匹配用**身份**而不是令牌名：同一份源码被两条解析路径载入（symlink 与真实路径）时
 * 类身份不同但令牌名一致——按身份才谈得上「运行期重组」。
 */
function entryIdentityOf(entry: ProviderEntry): unknown {
  if (typeof entry === "function") {
    return (entry as { providerBase?: Function }).providerBase ?? entry;
  }
  if (typeof entry === "object" && entry !== null && "provide" in entry) {
    const provide = entry.provide as { providerBase?: Function } & Function;
    return provide.providerBase ?? provide;
  }
  return entry;
}

function providerKeyOf(entry: ProviderEntry): unknown {
  if (typeof entry === "function") {
    return (entry as { providerBase?: Function }).providerBase ?? entry;
  }
  if (typeof entry === "object" && entry !== null && "provide" in entry) {
    const provide = entry.provide as { providerBase?: Function } & Function;
    return provide.providerBase ?? provide;
  }
  return undefined;
}

/**
 * 清单合并：同一 token 的 Provider 后者覆盖前者；multi 与无名条目保持原样。
 *
 * 覆盖者占据**自己的声明位置**（先删后插）：装配顺序按声明顺序排同层依赖，
 * 覆盖者往往依赖后出现的服务（如 `StorageDomain` 覆盖成 rdb 后端，rdb 后端由后面的行提供）。
 */
export function dedupeProviders(entries: readonly ProviderEntry[]): ProviderEntry[] {
  const keyed = new Map<unknown, ProviderEntry>();
  const plain: ProviderEntry[] = [];
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "multi" in entry) {
      plain.push(entry);
      continue;
    }
    const key = providerKeyOf(entry);
    if (key === undefined) {
      plain.push(entry);
      continue;
    }
    if (keyed.has(key)) keyed.delete(key);
    keyed.set(key, entry);
  }
  return [...keyed.values(), ...plain];
}

/**
 * 本次装配里**确实会 provide 自己实例**的令牌：`inject.optional()` 据此区分「还没就位」与「装配里没有」。
 * 排除两类——multi 贡献（`contribute` 走 `provideMulti`，不在令牌视图里）与 `providesService === false`
 * 的适配型 provider（服务由上游插件按名字注册，它自己的令牌永远不会被 provide，等它会等成超时）。
 */
export function plannedTokensOf(entries: readonly ProviderEntry[]): ReadonlySet<Token> {
  const planned = new Set<Token>();
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "multi" in entry) continue;
    if (typeof entry === "object" && entry !== null && "useFactory" in entry) {
      planned.add((entry as { provide: Token }).provide);
      continue;
    }
    const provide = typeof entry === "function" ? entry : (entry as { provide?: Token }).provide;
    if (typeof provide !== "function") continue;
    // 上游 cordis 插件类没有 zephyr 令牌（走 ctx.plugin 装配），不进计划表。
    // 适配型 Provider（`fromCordis`）：令牌最终解析到上游实例（mount 里回填），同样算「装配里有它」。
    const meta = tryGetTokenMeta(provide);
    // 装配里会提供它的几种形态：Service 类（`providesService`）、适配（`serviceClass`）、
    // `fromCordisService` 那种解析式（`serviceResolver`），以及**绑定契约令牌**的适配类
    // （`meta.token !== meta.impl`，上游实例在 mount 后回填到契约上）。
    if (
      meta !== undefined &&
      (meta.providesService === true ||
        meta.serviceClass !== undefined ||
        meta.serviceResolver !== undefined ||
        meta.token !== meta.impl)
    ) {
      planned.add(meta.token);
    }
    for (const alias of meta?.aliases ?? []) planned.add(alias);
    // 多契约适配（`fromCordis([A, B], 上游)`）：这一行**同时**实现 B，B 也算「装配里有它」。
    for (const extra of (provide as { alsoTokens?: readonly Token[] }).alsoTokens ?? []) {
      if (extra !== undefined) planned.add(extra);
    }
  }
  return planned;
}

/**
 * 解析清单里的 `without` 标记。
 *
 * - `without(entry)`（没给表达式）→ 从列表里剔除该条目；
 * - `without(entry, expr)` → **保留**该条目（表达式只写进 patch 的 disabled，运行期不解释）。
 * @param entries - 已经摊平过的条目。
 * @returns 剔除后的条目，顺序不变。
 */
export function resolveWithout(entries: readonly ProviderEntry[]): ProviderEntry[] {
  const excluded = new Set<unknown>();
  for (const entry of entries) {
    if (!isWithoutRef(entry)) continue;
    if (entry.disabled === undefined) excluded.add(entryIdentityOf(entry.entry));
  }
  const resolved: ProviderEntry[] = [];
  for (const entry of entries) {
    if (isWithoutRef(entry)) {
      const base = entry.entry;
      if (entry.disabled !== undefined && !excluded.has(entryIdentityOf(base))) resolved.push(base);
      continue;
    }
    if (excluded.has(entryIdentityOf(entry))) continue;
    resolved.push(entry);
  }
  return resolved;
}

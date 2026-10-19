import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { Token } from "./injection.ts";
import { getTokenName } from "./token-meta.ts";


export interface ServiceTable {
  tokens: Map<Token, unknown>;
  names: Map<string, unknown>;

  multi: Map<Token, unknown[]>;

  /** 等待某个键就绪的回调（`wait()` / `provide` 唤醒）。 */
  waiters: Map<ServiceKey, (() => void)[]>;

  /** 本次装配里会 provide 自己实例的令牌（`inject.optional` 的「没就位 vs 没有」判据）。 */
  plannedTokens: Set<Token>;

  /** 同一份源码被两条解析路径载入时类身份不同、令牌名一致：计划表同时按名字记一份。 */
  plannedTokenNames: Set<string>;
}

export function createServiceTable(): ServiceTable {
  return {
    tokens: new Map(),
    names: new Map(),
    multi: new Map(),
    waiters: new Map(),
    plannedTokens: new Set(),
    plannedTokenNames: new Set(),
  };
}

type ServiceKey = Token | string;

// 服务表挂在**根 ctx** 上（`Symbol` 属性），模块不持有「ctx → 表」的映射。
const kServiceTable = Symbol.for("morlay.zephyr.service-table");

/** 服务表的容器是 Cordis 根 ctx：同一棵 ctx 树里的所有 dsh 行共享一张表。 */
function rootOf(ctx: Context): Context {
  const root = (ctx as { root?: Context }).root;
  return root ?? ctx;
}

export function bindServiceTable(ctx: Context, table: ServiceTable): void {
  Object.defineProperty(rootOf(ctx), kServiceTable, { value: table, configurable: true, writable: true });
}

/** 取（必要时创建）根 ctx 的服务表；`bootstrapApplication` 与各 dsh 行共用这一张。 */
export function serviceTableOf(ctx: Context): ServiceTable {
  return tableOf(ctx);
}

function tableOf(ctx: Context): ServiceTable {
  const root = rootOf(ctx);
  let table = (root as { [kServiceTable]?: ServiceTable })[kServiceTable];
  if (table === undefined) {
    table = createServiceTable();
    Object.defineProperty(root, kServiceTable, { value: table, configurable: true, writable: true });
  }
  return table;
}

function wake(table: ServiceTable, key: ServiceKey): void {
  const list = table.waiters.get(key);
  if (list === undefined) return;
  table.waiters.delete(key);
  for (const wake of list) wake();
}

function publish(
  table: ServiceTable,
  into: Map<ServiceKey, unknown>,
  key: ServiceKey,
  value: unknown,
): () => void {
  into.set(key, value);
  wake(table, key);
  return () => {
    into.delete(key);
  };
}

export function provideService(ctx: Context, token: Token, value: unknown): () => void {
  const table = tableOf(ctx);
  const unpublish = publish(table, table.tokens, token, value);
  // 上游兼容：Provider 实例若自带 `name`（契约里声明的读取键），把它放到根 ctx 的同名槽位上，
  // 原生 cordis 行（`ctx.get(name)`）就能读到。`Service` 子类在 `super()` 时已自己注册，跳过。
  const ctor = (value as { constructor?: { prototype?: object } }).constructor;
  const isCordisService = ctor?.prototype instanceof Service;
  if (!isCordisService && Object.hasOwn(value as object, "name")) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) {
      const root = (ctx as unknown as { root?: Context }).root ?? ctx;
      const reflect = (root as unknown as {
        reflect?: { get(name: string): unknown; provide(name: string, v: unknown): void };
      }).reflect;
      if (reflect !== undefined && reflect.get(name) === undefined) {
        reflect.provide(name, value);
      }
    }
  }
  // 令牌名就是宿主服务名（`InjectionToken("typert")` ↔ `ctx.typert`）：一并写进名字视图。
  const name = (token as { serviceName?: unknown }).serviceName;
  if (typeof name === "string" && name.length > 0) {
    const unname = publish(table, table.names, name, value);
    return () => {
      unname();
      unpublish();
    };
  }
  return unpublish;
}

export function publishServiceName(ctx: Context, name: string, value: unknown): () => void {
  const table = tableOf(ctx);
  return publish(table, table.names, name, value);
}

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

/**
 * 本次装配里**确实会 provide 自己实例**的令牌（装配期由 `bootstrapApplication` 登记）。
 * `inject.optional()` 靠它区分「还没就位」与「装配里就没有」——前者要等（与 `inject()` 同一口径），
 * 后者才是 `undefined`。于是 optional 也不再看 provider 的先后。
 */

export function bindPlannedTokens(ctx: Context, tokens: ReadonlySet<Token>): void {
  const table = tableOf(ctx);
  for (const token of tokens) {
    table.plannedTokens.add(token);
    table.plannedTokenNames.add(getTokenName(token));
  }
}

export function isPlannedToken(ctx: Context, token: Token): boolean {
  const table = tableOf(ctx);
  if (table.plannedTokens.has(token)) return true;
  return table.plannedTokenNames.has(getTokenName(token));
}

export function provideMulti(ctx: Context, token: Token, value: unknown): () => void {
  const table = tableOf(ctx);
  const list = table.multi.get(token);
  if (list === undefined) {
    table.multi.set(token, [value]);
    wake(table, token);
    return () => {
      table.multi.delete(token);
    };
  }
  list.push(value);
  wake(table, token);
  return () => {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
  };
}

export function resolveMulti(ctx: Context, token: Token): unknown[] {
  return tableOf(ctx).multi.get(token) ?? [];
}

export function isMultiToken(ctx: Context, token: Token): boolean {
  return tableOf(ctx).multi.has(token);
}

export function resolveServiceName(ctx: Context, name: string): unknown {
  return tableOf(ctx).names.get(name);
}

/** 名字视图的全部条目：适配令牌按实例类型找「由 fromCordis 挂载的上游服务」时用。 */
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

export function serviceNamesOf(ctx: Context): ReadonlyMap<string, unknown> {
  return tableOf(ctx).names;
}

function wait(ctx: Context, key: ServiceKey, present: unknown): Promise<void> {
  if (present !== undefined) return Promise.resolve();
  const table = tableOf(ctx);
  return new Promise((resolve) => {
    const waiters = table.waiters;
    const list = waiters.get(key) ?? [];
    list.push(resolve);
    waiters.set(key, list);
  });
}

export function awaitService(ctx: Context, token: Token): Promise<void> {
  return wait(ctx, token, resolveService(ctx, token));
}

export function awaitServiceName(ctx: Context, name: string): Promise<void> {
  return wait(ctx, name, resolveServiceName(ctx, name));
}

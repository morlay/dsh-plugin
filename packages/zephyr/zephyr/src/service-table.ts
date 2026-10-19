// 服务表（SRP：**只管这张表与它的写入**）。
//
// - 结构：`ServiceTable`（令牌 / 名字 / multi / 等待者 / 计划表）
// - 写入：`provideService` / `publishServiceName` / `bindNamedTokens` / `provideMulti`
// - 位置：表挂在 Cordis **根 ctx**（同一条树里的 dsh 行共享一张）
//
// 读操作在 `service-resolver.ts`，装配计划在 `service-plan.ts`：三份各管一件事，
// 读的调用方不必看到写入用的 `Map`。
import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import type { Token } from "./injection.ts";
import { tokensNamed } from "./token-meta.ts";

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

export type ServiceKey = Token | string;

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

/** 内部：解析与等待也要读这张表（不上包出口）。 */
export function tableOf(ctx: Context): ServiceTable {
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
  const unname = publish(table, table.names, name, value);
  const unlink = bindNamedTokens(ctx, name, value);
  return () => {
    unlink();
    unname();
  };
}

/**
 * 把「注册名就是 `name`」的令牌指向 `value`（不发布名字视图）。
 *
 * 上游行在自己的 apply 里 `ctx.reflect.provide('<name>', …)` 建出跨行共享注册表；这个名字按隔离规则
 * **不进根名字视图**，但同名令牌（`InjectionToken(name)` / 契约上的 `static serviceName`）必须指向
 * 同一个实例——消费方 `inject(令牌)` 与上游行按名字读到的是同一份。
 * @param ctx - 任意作用域的 ctx（服务表按根 ctx 共享）。
 * @param name - 上游注册名。
 * @param value - 该名字对应的实例。
 * @returns 撤销这次令牌绑定的函数。
 */
export function bindNamedTokens(ctx: Context, name: string, value: unknown): () => void {
  const table = tableOf(ctx);
  const unlink = tokensNamed(name).map((token) => publish(table, table.tokens, token, value));
  return () => {
    for (const off of unlink) off();
  };
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

/**
 * 内部：等某个键就绪（解析的等待版用它，写入的 `publish` 唤醒它）。
 * @param ctx - 任意作用域的 ctx。
 * @param key - 令牌或名字。
 * @param present - 当前值；`undefined` 表示还没就位。
 * @returns 就绪时 resolve。
 */
export function waitFor(ctx: Context, key: ServiceKey, present: unknown): Promise<void> {
  if (present !== undefined) return Promise.resolve();
  const table = tableOf(ctx);
  return new Promise((resolve) => {
    const waiters = table.waiters;
    const list = waiters.get(key) ?? [];
    list.push(resolve);
    waiters.set(key, list);
  });
}

// 行作用域：zephyr 自己的 ctx 面，**不转发** cordis 的生命周期。
// 上游插件（apply / 类插件）看到的 `ctx` 就是这个作用域：`inject` / `effect` / `provide` / `plugin`
// 都由它实现，effect 收进本作用域的栈、卸载时逆序执行；cordis 只在最外层出现（`root`）。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import { awaitServiceName, publishServiceName, resolveServiceName } from "./service-table.ts";

export interface ServiceScopeOptions {
  /** 上游发布的服务名是否也落到根 ctx（`storage` / `webStartup` 这类原生名）。 */
  /** 本行已有的名字 → 值（deps 快照）。 */
  readonly local?: Map<string, unknown>;
  /** 发布回调（适配层用它收集 onProvide）。 */
  readonly onProvide?: (name: string, value: unknown) => () => void;
  /**
   * 读面是否放行名字视图：上游插件按 `ctx.<service>` 读兄弟行发布的名字，需要它；
   * 我们自己的 Provider（onInit）保持 cordis 行 ctx 语义——属性读只认注入过的依赖。
   */
  readonly readNames?: boolean;

  /** 适配行（上游插件自己的 `ctx.inject` 负责等依赖）：未就绪的名字读 `undefined`，不抛错。 */
  readonly permissiveRead?: boolean;

  /** 上游 `inject` 声明的名字：未就绪时读 `undefined`（等 `ctx.inject`），未声明的仍按严格读面报错。 */
  readonly declaredNames?: ReadonlySet<string>;
}

/** 作用域上指向真实行 ctx 的键：读 symbol 对 cordis ctx 代理是安全的，不会触发「未声明属性」错误。 */
export const kServiceScope = Symbol("zephyr.service-scope");

export interface ServiceScope {
  /** 建立作用域的那一行 ctx（真实 cordis ctx）：适配层发布服务、转发 cordis 能力时用它。 */
  readonly [kServiceScope]: CordisContext;
  readonly root: CordisContext;
  readonly fiber: {
    state: number;
    uid: number | null;
    name: string;
    /** 行作用域自成一个根：上游沿 `fiber.parent.fiber` 找生命周期祖先时能安全收敛。 */
    parent: ServiceScope;
    runtime: null;
    store: Record<string, unknown>;
    ctx: ServiceScope;
    dispose(): Promise<void>;
  };
  get(name: string, fallback?: unknown): unknown;
  set(name: string, value: unknown): void;
  provide(name: string, value: unknown): () => void;
  effect(fn: () => unknown, label?: string): () => void;
  on(event: string, listener: (...args: never[]) => void): () => void;
  inject(
    names: readonly string[],
    callback?: (scope: ServiceScope) => unknown,
  ): Promise<unknown> & { dispose(): void };
  /** 子插件：上游插件在自己的 apply 里挂子插件时走它（仍交给 cordis 的 plugin 装载）。 */
  plugin(sub: unknown, config?: unknown): unknown;
  readonly reflect: { get(name: string): unknown; provide(name: string, value: unknown): () => void };
  readonly logger: unknown;
  [key: string]: unknown;
}

const ACTIVE = 2;

export function createServiceScope(
  ctx: CordisContext,
  options: ServiceScopeOptions = {},
): ServiceScope {
  const local = options.local ?? new Map<string, unknown>();
  const effects: Array<() => unknown> = [];
  // 回调拿到的是作用域代理（属性读同样走读面），不是裸对象。
  let scopeProxy: ServiceScope;

  // 显式查找（`get` / `inject` / `reflect.get` 用）：先本行快照，再行 ctx，最后根 ctx。
  const lookup = (name: string): unknown => {
    if (local.has(name)) return local.get(name);
    const published = resolveServiceName(ctx, name);
    if (published !== undefined) return published;
    // `permissiveRead`：上游 `Service` 在**构造里**就读 `ctx.<service>`（`api-gateway` 的 `connection`），
    // 而 cordis 的 ctx 代理对"未声明注入"的名字会抛错。这里把抛错当成"还没就绪"（返回 undefined），
    // 让上游自己的 `ctx.inject([...], cb)` 在依赖就绪后回调。
    const safeGet = (target: unknown, key: string): unknown => {
      try {
        return (target as { get?: (name: string) => unknown }).get?.(key);
      } catch (error) {
        if (options.permissiveRead === true) return undefined;
        throw error;
      }
    };
    const direct = safeGet(ctx, name);
    if (direct !== undefined) return direct;
    // 根**名字视图**（我们的表）先于 cordis 的 `ctx.root.get`：兄弟行发布到根的是 `publishServiceName`
    // 写进名字视图的值，cordis 的 `get` 对"未声明注入"的名字会抛（被 permissiveRead 吞成 undefined）。
    const fromRootNames = resolveServiceName(ctx.root, name);
    if (fromRootNames !== undefined) return fromRootNames;
    return safeGet(ctx.root, name);
  };

  const fiber: ServiceScope["fiber"] = {
    state: ACTIVE,
    uid: null,
    name: "zephyr-row",
    parent: undefined as unknown as ServiceScope,
    runtime: null,
    store: Object.create(null) as Record<string, unknown>,
    ctx: undefined as unknown as ServiceScope,
    async dispose() {
      const list = effects.splice(0).reverse();
      for (const undo of list) await undo();
    },
  };
  const scope: ServiceScope = {
    [kServiceScope]: ctx,
    root: ctx.root as CordisContext,
    fiber,
    get(name, fallback) {
      const found = lookup(name);
      return found === undefined ? fallback : found;
    },
    set(name, value) {
      local.set(name, value);
    },
    provide(name, value) {
      console.error(`[scope.provide] ${name}`);
      // 有 onProvide 时由适配层决定发布时机（Service 要等 init 完成，且只在 mount 末尾落根 ctx）。
      local.set(name, value);
      const unregister = options.onProvide?.(name, value) ?? publishServiceName(ctx, name, value);
      let undone = false;
      const undo = () => {
        if (undone) return;
        undone = true;
        local.delete(name);
        unregister();
      };
      // 作用域卸载时自动撤销本行发布的服务（cordis fiber 的同一语义），调用方提前撤销也不会重复。
      effects.push(undo);
      return undo;
    },
    effect(fn) {
      // 与 cordis 的 `ctx.effect` 同一语义：同步函数、generator / Iterable（逐个 yield 清理）、
      // Promise / AsyncIterable；卸载时逆序执行，重复调用只跑一次。
      const disposables: Array<() => unknown> = [];
      const collect = (undo: unknown): void => {
        if (typeof undo === "function") disposables.push(undo as () => unknown);
      };
      const dispose = (): void => {
        for (const undo of disposables.splice(0).reverse()) undo();
      };
      const result = fn();
      if (typeof result === "function" || result === null || result === undefined) {
        collect(result);
      } else if (typeof result === "object" && "then" in result) {
        void Promise.resolve(result as PromiseLike<unknown>).then(collect);
      } else if (typeof result === "object" && Symbol.iterator in result) {
        for (const undo of result as Iterable<unknown>) collect(undo);
      } else if (typeof result === "object" && Symbol.asyncIterator in result) {
        void (async () => {
          for await (const undo of result as AsyncIterable<unknown>) collect(undo);
        })();
      }
      effects.push(dispose);
      return dispose;
    },
    on(event, listener) {
      // 事件总线是 cordis 的 `ctx.events`：行内的上游插件与我们自己的 Provider 共用一条。
      return (
        ctx as unknown as {
          on(type: string, listener: (...args: never[]) => void): () => void;
        }
      ).on(event, listener);
    },
    inject(names, callback) {
      let disposed = false;
      // 返回可 await 的激活任务：名字晚到时由 `awaitServiceName` 的唤醒信号推进，不靠忙等。
      const run = (async () => {
        for (const name of names) {
          const deadline = Date.now() + 3000;
          while (!disposed && lookup(name) === undefined && Date.now() < deadline) {
            await Promise.race([
              awaitServiceName(ctx, name),
              new Promise((resolve) => setTimeout(resolve, 10)),
            ]);
          }
          const value = lookup(name);
          if (value === undefined) return undefined;
          local.set(name, value);
        }
        if (disposed) return undefined;
        return callback?.(scopeProxy);
      })();
      return Object.assign(run, {
        dispose() {
          disposed = true;
        },
      });
    },
    plugin(sub, config) {
      return (ctx as unknown as { plugin(p: unknown, c?: unknown): unknown }).plugin(sub, config);
    },
    reflect: {
      get(name) {
        return lookup(name);
      },
      provide(name, value) {
        return scope.provide(name, value);
      },
    },
    logger: (ctx as unknown as { logger?: unknown }).logger,
  };
  fiber.ctx = scope;
  // 读面与 cordis 行 ctx 对齐：只有**本行拿到的依赖**（local 快照）与作用域自身成员可读；
  // 其余属性直接报错（`cannot get property "x" without inject`），依赖漏声明当场暴露。
  // 需要按名字读取的地方走显式 API：`get()` / `inject()` / `reflect.get()`。
  const known = (prop: string): boolean => prop in scope;
  scopeProxy = new Proxy(scope, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      if (local.has(prop)) return local.get(prop);
      if (known(prop)) return Reflect.get(target, prop, receiver);
      if (prop === "then" || prop === "toJSON" || prop === "constructor") return undefined;
      if (options.permissiveRead === true && options.declaredNames?.has(prop) === true) {
        const value = lookup(prop);
        if (value !== undefined) return value;
        if (prop in ctx) {
          const own = Reflect.get(ctx as object, prop) as unknown;
          return typeof own === "function" ? (own as (...args: never[]) => unknown).bind(ctx) : own;
        }
        return undefined;
      }
      if (options.readNames === true) {
        const value = lookup(prop);
        if (value !== undefined) return value;
      }
      // cordis 行 ctx 自身的能力（events / registry / fiber / emit / waterfall ...）直接转发：
      // 作用域只接管 DI 与发布，不重写上游的事件与调度语义。
      if (prop in ctx) {
        const value = Reflect.get(ctx as object, prop) as unknown;
        return typeof value === "function" ? (value as (...args: never[]) => unknown).bind(ctx) : value;
      }
      throw new Error(`cannot get property "${prop}" without inject`);
    },
    has(target, prop) {
      if (typeof prop === "string" && local.has(prop)) return true;
      if (prop in target) return true;
      return options.readNames === true && typeof prop === "string" && lookup(prop) !== undefined;
    },
  }) as ServiceScope;
  fiber.ctx = scopeProxy;
  // 上游沿 `fiber.parent.fiber` 找生命周期祖先：parent 要是「有 fiber 的 ctx」，作用域代理就是。
  fiber.parent = scopeProxy;
  return scopeProxy;
}

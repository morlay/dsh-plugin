// 行作用域：zephyr 自己的 ctx 面，**不转发** cordis 的生命周期。
// 上游插件（apply / 类插件）看到的 `ctx` 就是这个作用域：`inject` / `effect` / `provide` / `plugin`
// 都由它实现，effect 收进本作用域的栈、卸载时逆序执行；cordis 只在最外层出现（`root`）。
import { Context as CordisContextValue, type Context as CordisContext } from "@deepseek-ai/cordis";
import { publishServiceName } from "./service-table.ts";
import { awaitServiceName, resolveServiceName } from "./service-resolver.ts";

/**
 * cordis 的服务隔离表键：`Service` 的 `[symbols.filter]` 用它判断「两个 ctx 看到的是不是同一个实例」。
 * 行作用域不是真 cordis ctx，这个键必须自己给——否则任何 scoped 事件派发（`scopeTarget` 会转发
 * `baseFilter`）都会在 `ctx[isolate][serviceName]` 上读到 `undefined`。
 */
const kCordisIsolate = CordisContextValue.isolate;

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

  /** 行 ctx 的 `logger`（上游插件普遍读 `ctx.logger.<level>`）。 */
  readonly logger?: unknown;

  /** 上游 `inject` 声明的名字：未就绪时读 `undefined`（等 `ctx.inject`），未声明的仍按严格读面报错。 */
  readonly declaredNames?: ReadonlySet<string>;

}

/** 作用域上指向真实行 ctx 的键：读 symbol 对 cordis ctx 代理是安全的，不会触发「未声明属性」错误。 */
export const kServiceScope = Symbol("zephyr.service-scope");

export interface ServiceScope {
  /** 建立作用域的那一行 ctx（真实 cordis ctx）：适配层发布服务、转发 cordis 能力时用它。 */
  readonly [kServiceScope]: CordisContext;
  /**
   * cordis 的服务隔离表：按服务名给出**本作用域看到的**那个实例（`Service.[symbols.filter]` 读它）。
   * 实现是活的：读的那一刻按本作用域的查找顺序解析，不缓存。
   */
  readonly [kCordisIsolate]: Record<string, unknown>;
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
    /** 上游在每次操作前自检「ctx 还活着」（`AgentLoop.create` 等）。 */
    assertActive(): void;
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
  /**
   * 子插件：在本行作用域下开一个**子作用域**执行（cordis `ctx.plugin` 的语义：独占注册、随父卸载）。
   * 返回值是 cordis 的 fiber 形状（`{ ctx, dispose }`）——上游会读 `fiber.ctx.extend(...)`。
   */
  plugin(sub: unknown, config?: unknown): { readonly ctx: ServiceScope; dispose(): void };
  /** cordis `ctx.extend`：派生出带额外属性的 ctx（读面继承本作用域）。 */
  extend(props?: Record<string, unknown>): ServiceScope;
  readonly reflect: { get(name: string): unknown; provide(name: string, value: unknown): () => void };
  readonly logger: unknown;
  [key: string]: unknown;
}

const ACTIVE = 2;

// 行作用域的 fiber 需要**非空 uid**：上游服务用 `ownerFiber.uid !== null && state === ACTIVE`
// 判断「我还活着」（如 `session-title` 的 `serviceActive()`）。uid 只要求非空且互异。
let nextFiberUid = 1;

/**
 * 报错信息里用的子插件描述（类名 / 函数名 / 对象）。
 * @param sub - 传给 `ctx.plugin` 的子插件。
 * @returns 简短可读的描述。
 */
function describeSub(sub: unknown): string {
  if (typeof sub === "function") {
    const name = (sub as { name?: string }).name;
    return name === undefined || name === "" ? "<anonymous plugin>" : name;
  }
  if (typeof sub === "object" && sub !== null) {
    const name = (sub as { name?: unknown }).name;
    return typeof name === "string" ? name : "<plugin object>";
  }
  return String(sub);
}

/**
 * `ctx.extend(props)`：派生一个带额外属性的作用域代理，读面/写面都继承父作用域。
 *
 * cordis 的 `createScope` 会 `fiber.ctx.extend({ [kScope]: key })`，那条链必须落在我们的作用域里，
 * 不能退回真实 cordis ctx —— 退回就等于跨出了本行的隔离。
 * @param parent - 父作用域代理。
 * @param props - 派生 ctx 上额外可见的属性。
 * @returns 派生代理。
 */
function deriveScope(parent: ServiceScope, props?: Record<string, unknown>): ServiceScope {
  if (props === undefined) return parent;
  return new Proxy(parent, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && Object.hasOwn(props, prop)) return props[prop];
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === "string" && Object.hasOwn(props, prop)) return true;
      return Reflect.has(target, prop);
    },
  }) as ServiceScope;
}

export function createServiceScope(
  ctx: CordisContext,
  options: ServiceScopeOptions = {},
): ServiceScope {
  const local = options.local ?? new Map<string, unknown>();
  const effects: Array<() => unknown> = [];
  // 回调拿到的是作用域代理（属性读同样走读面），不是裸对象。
  let scopeProxy: ServiceScope;

  /** 把名字写进本行快照（`set` / `provide` / `inject` 共用的写面）。 */
  const assignName = (name: string, value: unknown): void => {
    local.set(name, value);
  };

  /** 注册一个服务名：进本行快照并交给发布回调（适配层决定发布时机），返回逆序撤销。 */
  const provideName = (name: string, value: unknown): (() => void) => {
    assignName(name, value);
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
  };

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
    uid: nextFiberUid++,
    name: "zephyr-row",
    parent: undefined as unknown as ServiceScope,
    runtime: null,
    store: Object.create(null) as Record<string, unknown>,
    ctx: undefined as unknown as ServiceScope,
    assertActive() {
      // 行作用域在卸载前始终是 active：上游只在「已 disposed 的 ctx 上继续用」时报错，
      // 我们的 `dispose()` 由 `effects` 清空后统一收尾，这里不需要额外状态。
    },
    async dispose() {
      const list = effects.splice(0).reverse();
      for (const undo of list) await undo();
    },
  };
  const scope: ServiceScope = {
    [kServiceScope]: ctx,
    // 活的隔离表：`[symbols.filter]` 比较「监听者 ctx 看到的实例」与「本行 ctx 看到的实例」，
    // 所以这里必须按本行的查找顺序（`local` → 已发布名 → 行 ctx → 根）现算。
    [kCordisIsolate]: new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, name) => (typeof name === "string" ? lookup(name) : undefined),
    }),
    root: ctx.root as CordisContext,
    fiber,
    get(name, fallback) {
      const found = lookup(name);
      return found === undefined ? fallback : found;
    },
    set(name, value) {
      assignName(name, value);
    },
    provide(name, value) {
      // 有 onProvide 时由适配层决定发布时机（Service 要等 init 完成，且只在 mount 末尾落根 ctx）。
      return provideName(name, value);
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
      // cordis 的 `ctx.plugin(sub, config)`：**在本行作用域下开一个子作用域**执行。
      // 服务名进子作用域的 `local`（不碰根 cordis 表、不跨行污染），生命周期随本行 `effects` 回收。
      // 返回值是 fiber 形状——上游会读 `fiber.ctx.extend(...)`（`core/scope` 的 `createScope`）。
      // **共享父作用域的 `local`**：cordis 里子 fiber 提供的服务父 fiber 读得到（`ctx.get('commandUi')`），
      // 所以子插件 provide 的名字要落在本行的名字表里；卸载时把子新增的键清掉。
      const inherited = new Set(local.keys());
      const child = createServiceScope(ctx, {
        local,
        ...(options.onProvide === undefined ? {} : { onProvide: options.onProvide }),
        ...(options.readNames === undefined ? {} : { readNames: options.readNames }),
        ...(options.permissiveRead === undefined ? {} : { permissiveRead: options.permissiveRead }),
        ...(options.declaredNames === undefined ? {} : { declaredNames: options.declaredNames }),
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      });
      let disposed = false;
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        void child.fiber.dispose();
        for (const name of Array.from(local.keys())) {
          if (!inherited.has(name)) local.delete(name);
        }
      };
      effects.push(dispose);

      // Service 子类：显式构造（它的 `super(ctx, name)` 会把实例注册进子作用域）。
      if (typeof sub === "function" && Function.prototype.toString.call(sub).startsWith("class")) {
        const instance = new (sub as new (ctx: ServiceScope, config?: unknown) => { dispose?: () => unknown })(
          child,
          config,
        );
        const inner = (): void => {
          void instance.dispose?.();
        };
        effects.push(inner);
        return { ctx: child, dispose: () => { inner(); dispose(); } };
      }
      // 函数式插件 / 带 `apply` 的对象插件：同在子作用域里调用。
      const applyBody = typeof sub === "function"
        ? (sub as (ctx: ServiceScope, config?: unknown) => unknown)
        : typeof sub === "object" && sub !== null && typeof (sub as { apply?: unknown }).apply === "function"
          ? (sub as { apply(ctx: ServiceScope, config?: unknown): unknown }).apply.bind(sub)
          : undefined;
      if (applyBody === undefined) {
        throw new Error(`ctx.plugin(...) 不接受这种子插件形态：${describeSub(sub)}`);
      }
      const result = applyBody(child, config);
      if (typeof result === "function") effects.push(result as () => unknown);
      return { ctx: child, dispose };
    },
    extend(props) {
      return deriveScope(scopeProxy, props);
    },
    // 反射面 = 真 cordis `ReflectService` 的派生对象：只接管**读写面**的两个入口（`get` / `provide`），
    // `props` / `store` / `accessor` / `mixin` 仍来自上游。上游 traceable 代理读服务成员时会走
    // `ctx.reflect.props['<service>.<member>']`，丢了 `props` 就是
    // `Cannot read properties of undefined (reading 'agentLoop.runtime')`。
    // 不接管 `set`：cordis 的 `reflect.set` 带三条约束（未 provide 抛错、owner fiber 校验、写回已发布值），
    // 换成「只写本行 local」就丢掉了它们。
    reflect: Object.create(Reflect.get(ctx as object, "reflect") as object, {
      get: { value: (name: string) => lookup(name) },
      provide: { value: (name: string, value: unknown) => provideName(name, value) },
    }) as ServiceScope["reflect"],
    logger: options.logger ?? (ctx as unknown as { logger?: unknown }).logger,
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
      // `invocation` 是上游 Typert 的**调用上下文**：Remote 调用里有值，其余情况是 `undefined`
      // （上游 `provideInvocationAccessor` 注册的 accessor 就是这个语义，它带 `Context.is(ctx)` 前置判断，
      // 我们的作用域不是 cordis Context，所以那个 accessor 从没注册过）。
      // 只对这一个已知的可选 accessor 给同样语义——**不抛**：`SessionController.prompt` 会无条件读它。
      // 不做通用兜底：那会让拼错属性名也静默成 `undefined`。
      if (prop === "invocation") return undefined;
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

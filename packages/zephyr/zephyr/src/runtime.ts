// 一行 = 一个 runtime：构造（同步）→ 解析依赖 → 发布 → onInit；卸载逆序。
// 它**不经过 cordis 的 fiber 状态机**（那个状态机在 bootstrap 场景下不可靠地推进），
// 生命周期由 bootstrap / toCordis 直接调度——这正是「DI 不依赖 cordis」的落点。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import { construct, resolvePending, type PendingHost } from "./attach.ts";
import { createServiceScope, type ServiceScope } from "./service-scope.ts";
import { awaitServiceNames, callPlugin } from "./call-plugin.ts";
import { provideMulti, provideService } from "./service-table.ts";
import { getTokenName, type TokenMeta } from "./token-meta.ts";
import type { PluginRef } from "./upstream-plugin.ts";
import type { Lifecycle, Token } from "./injection.ts";

export interface RowRuntime {
  readonly name: string;
  readonly token: Token;
  /** 这一行要等的令牌（字段注入的依赖）。 */
  readonly dependencies: readonly Token[];
  /** 同步构造；依赖在 `start()` 里解析。`ensure` 由装配方提供：就地启动依赖行，而不是轮询等。 */
  start(host?: RuntimeHost): Promise<void>;
  dispose(): Promise<void>;
}

/** 装配方给行运行时的就绪通道。 */
export type RuntimeHost = PendingHost;

/** 这一行会提供哪些令牌（主令牌 + 别名；适配类的主令牌在 `start()` 里回填，但声明上归它）。 */
export function tokensProvidedBy(runtime: RowRuntime): readonly Token[] {
  return [runtime.token];
}

/**
 * 按依赖关系排序：被依赖的先 start。
 * - `providers` 覆盖「哪些令牌由哪一行提供」，调用方可以把别名、resolver 型令牌一起传进来；
 * - 环依赖**直接抛错**（带路径）：装配错误必须在装配期暴露，不能留给运行期的「not available」。
 */
export function orderRuntimes(
  runtimes: readonly RowRuntime[],
  providers: ReadonlyMap<Token, number> = new Map(runtimes.map((runtime, index) => [runtime.token, index])),
): readonly RowRuntime[] {
  const order: number[] = [];
  const visited = new Set<number>();
  const visiting = new Set<number>();
  const path: number[] = [];
  const visit = (index: number): void => {
    if (visited.has(index)) return;
    // 环依赖是装配错误：当场报出来（带路径），不要「保持声明序」地继续跑——那只会把错误推给运行期。
    if (visiting.has(index)) {
      const cycle = [...path.slice(path.indexOf(index)), index]
        .map((item) => runtimes[item]!.name)
        .join(" -> ");
      throw new Error(`circular dependency in providers: ${cycle}`);
    }
    visiting.add(index);
    path.push(index);
    for (const dependency of runtimes[index]!.dependencies) {
      const provider = providers.get(dependency);
      if (provider !== undefined && provider !== index) visit(provider);
    }
    visiting.delete(index);
    path.pop();
    visited.add(index);
    order.push(index);
  };
  for (let index = 0; index < runtimes.length; index += 1) visit(index);
  return order.map((index) => runtimes[index]!);
}

/** `multi` 贡献：把值登记到多值令牌上，卸载时撤销。 */
export function createMultiRuntime(
  token: Token,
  value: unknown,
  ctx: CordisContext,
  name = `${getTokenName(token)}:contribution`,
): RowRuntime {
  let unregister: (() => void) | undefined;
  return {
    name,
    token,
    dependencies: [],
    async start() {
      unregister ??= provideMulti(ctx, token, value);
    },
    async dispose() {
      unregister?.();
      unregister = undefined;
    },
  };
}

/**
 * 裸 cordis 插件：等它声明的 `inject` 名字就绪再 apply，`provide` 落名字视图与根 ctx；
 * 卸载时跑插件返回的 disposer 与作用域的 effect 栈。
 */
export function createPluginRuntime(
  plugin: PluginRef,
  ctx: CordisContext,
  name: string,
  timeoutMs: number,
): RowRuntime {
  let scope: ServiceScope | undefined;
  let disposer: (() => unknown) | undefined;
  return {
    name,
    token: plugin as unknown as Token,
    dependencies: [],
    async start() {
      const declared = (plugin as { inject?: readonly string[] }).inject ?? [];
      const missing = await awaitServiceNames(ctx, declared, timeoutMs);
      if (missing.length > 0) {
        throw new Error(`dependencies not available: ${missing.join(", ")}`);
      }
      scope = createServiceScope(ctx, { readNames: true });
      const result = await callPlugin(plugin, scope as unknown as CordisContext, undefined);
      if (typeof result === "function") disposer = result;
    },
    async dispose() {
      disposer?.();
      await scope?.fiber.dispose();
    },
  };
}

/** `useFactory` 提供：装配时求值一次，卸载时撤销。 */
export function createFactoryRuntime(
  token: Token,
  factory: (ctx: CordisContext) => unknown,
  ctx: CordisContext,
  name = `${getTokenName(token)}:factory`,
): RowRuntime {
  let unregister: (() => void) | undefined;
  return {
    name,
    token,
    dependencies: [],
    async start() {
      unregister ??= provideService(ctx, token, factory(ctx));
    },
    async dispose() {
      unregister?.();
      unregister = undefined;
    },
  };
}

export function createRowRuntime(
  meta: TokenMeta,
  ctx: CordisContext,
  config: unknown,
): RowRuntime {
  // 构造错误留到 `start()`：装配方按依赖顺序启动，错误才会落在正确的行名上被包装。
  let constructed: ReturnType<typeof construct> | undefined;
  let constructError: unknown;
  try {
    constructed =
      meta.isValue === true
        ? // 值型令牌（`InjectionToken`）：`useValue` 就是服务本身，构造它只会造出另一个令牌类。
          { instance: config as Lifecycle & Record<PropertyKey, any>, pending: [] }
        : construct(meta.impl, ctx, config);
  } catch (error) {
    constructError = error;
  }
  const pending = constructed?.pending ?? [];
  const instance = constructed?.instance;
  const unregisters: (() => void)[] = [];
  // 行作用域就是 `onInit(ctx)` 收到的 ctx：属性读只认注入过的依赖，不再借道 cordis 的 root ctx。
  const scope: ServiceScope = createServiceScope(ctx);
  let published: (() => void) | undefined;
  let started: Promise<void> | undefined;

  return {
    name: meta.name,
    token: meta.token,
    dependencies: pending.map((item) => item.token),
    start(host) {
      started ??= (async () => {
        if (constructError !== undefined) throw constructError;
        await resolvePending(ctx, instance!, pending, unregisters, { host, scope });
        if (meta.providesService) published = provideService(ctx, meta.token, instance);
        for (const alias of meta.aliases ?? []) {
          unregisters.push(provideService(ctx, alias, instance));
        }
        await instance!.onInit?.(scope as unknown as CordisContext);
      })();
      return started;
    },
    async dispose() {
      await instance?.onDispose?.();
      await (instance as { disposeProvider?: () => unknown } | undefined)?.disposeProvider?.();
      for (const undo of unregisters.reverse()) undo();
      published?.();
      await scope.fiber.dispose();
    },
  };
}

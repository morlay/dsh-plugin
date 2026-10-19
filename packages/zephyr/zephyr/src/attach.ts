import { isAdaptedPlaceholder } from "./token.ts";
import { isAdapted } from "./token-meta.ts";
// 在行 ctx 上挂 Provider / 挂一组 Provider（attach 面）。
import type { Plugin } from "@deepseek-ai/cordis";
import { Context as CordisContext, Service } from "@deepseek-ai/cordis";
import { bindPlannedTokens, bindServiceTable, isMultiToken, provideService, resolveMulti, resolveService, resolveServiceByTokenName, serviceTableOf, type ServiceTable } from "./service-table.ts";
import { getTokenName, resolveToken, type TokenMeta } from "./token-meta.ts";

import type { Lifecycle, Newable, Token } from "./injection.ts";
import type { PluginClass } from "./upstream-plugin.ts";
import { isPlannedToken } from "./service-table.ts";
import { InjectPlaceholder, tryGetTokenMeta } from "./token-meta.ts";
import { namedServiceOf } from "./token.ts";
import { flattenProviders, plannedTokensOf } from "./module.ts";
import { EventEmitter } from "./api-group.ts";
import { type FactoryProvider } from "./provider.ts";
import type { ProviderList } from "./provider.ts";

interface InstanceResult {
  instance: Lifecycle & Record<PropertyKey, any>;
  pending: { key: PropertyKey; token: Token; optional: boolean; multi?: boolean }[];
}


// 上游 Service 基类的构造要真实行 ctx（`super(ctx, name)` 才能把服务注册到原生 ctx 上）；
// 其余 Provider 只收配置。
function isServiceProvider(impl: Newable): boolean {
  return impl.prototype instanceof Service;
}

export function construct(impl: Newable, ctx: CordisContext, config?: unknown): InstanceResult {
  const instance = (
    isServiceProvider(impl) ? new impl(ctx, config) : new impl(config)
  ) as Lifecycle & Record<PropertyKey, any>;

  const pending: { key: PropertyKey; token: Token; optional: boolean; multi?: boolean }[] = [];
  for (const key of Reflect.ownKeys(instance)) {
    const value = instance[key];
    if (value instanceof InjectPlaceholder) {
      // 只按类身份解析：类身份不同就是装配错了，明确报错（`resolvePending` 后面的分支会抛），
      // 不做"名字相同就当同一个"的兜底——那会把双实例问题藏起来。
      const resolved = resolveService(ctx, value.token);
      if (resolved !== undefined) {
        instance[key] = resolved;
      } else {
        const meta = tryGetTokenMeta(value.token);
        if (
          value.optional &&
          !isPlannedToken(ctx, value.token) &&
          meta?.serviceClass === undefined &&
          meta?.serviceResolver === undefined
        ) {
          // optional 只在**装配里根本没有这个令牌**时给 undefined；有提供者、只是还没就位，
          // 就与必填一样等它——否则 optional 注入的结果会取决于 provider 的先后。
          instance[key] = undefined;
        } else {
          pending.push({ key, token: value.token, optional: value.optional, multi: value.multi });
        }
      }
    }
  }

  for (const key of Reflect.ownKeys(instance)) {
    const value = instance[key];
    if (value instanceof EventEmitter && (value as any)["bind"]) {
      (value as any)["bind"](ctx);
    }
  }

  return { instance, pending };
}

// 依赖的等待上限：适配型令牌可能由上游插件按实例类型出现；有上限才谈得上「报错」而不是「卡住」。
const DEFAULT_WAIT_MS = 3000;

/** 装配方给行运行时的就绪通道（bootstrap 用它把「等」变成「启动依赖行 + 明确报错」）。 */
export interface PendingHost {
  /** 启动本批里提供该令牌的那一行（幂等）；返回 `false` 表示本批没有提供者。 */
  ensure(token: Token): Promise<boolean>;

  /** 等待上限。 */
  readonly timeoutMs: number;
}

function waitFor(read: () => unknown, deadline: number): Promise<unknown> {
  return new Promise((resolve) => {
    const tick = (): void => {
      const value = read();
      if (value !== undefined && !isAdaptedPlaceholder(value)) {
        resolve(value);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(undefined);
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

export async function resolvePending(
  ctx: CordisContext,
  instance: Lifecycle & Record<PropertyKey, any>,
  pending: readonly { key: PropertyKey; token: Token; optional: boolean; multi?: boolean }[],
  unregisters: (() => void)[],
  options: {
    host?: PendingHost | undefined;
    /** 行作用域：注入结果同步写进它的本行快照，`onInit(ctx)` 里按名字读得到。 */
    scope?: { set(name: string, value: unknown): void } | undefined;
  } = {},
): Promise<void> {
  const { host, scope } = options;
  const assign = (item: (typeof pending)[number], value: unknown): void => {
    // 注入解析的长期观测点：排查「某个面为什么是 undefined」的第一手信息。
    (ctx as { logger?: { debug?(format: string, ...args: unknown[]): void } }).logger?.debug?.(
      "[inject] %s ← %s",
      getTokenName(item.token),
      value === undefined ? "undefined" : typeof value,
    );
    instance[item.key] = value;
    scope?.set(getTokenName(item.token), value);
  };
  for (const item of pending) {
    // `inject.all()` 的占位：multi 贡献直接取集合（可选时缺省空数组）。
    if ("multi" in item && item.multi === true) {
      instance[item.key] = resolveMulti(ctx, item.token);
      continue;
    }
    if (isMultiToken(ctx, item.token)) {
      throw new Error(
        `"${getTokenName(item.token)}" is registered with multi contributions; use inject.all() to read them`,
      );
    }
    const meta = tryGetTokenMeta(item.token);
    const name = meta?.name ?? getTokenName(item.token);
    // 适配类的字段声明的是适配类（`inject(Seam)`），令牌表与计划表登记的是它绑定的契约令牌。
    const token = (meta?.token ?? item.token) as Token;
    const boundToken =
      meta?.serviceClass === undefined ? undefined : (resolveToken(token) ?? token);
    const provided = host === undefined ? false : await host.ensure(token);
    const planned = isPlannedToken(ctx, token);

    // 已就绪：令牌表（身份 → 令牌名）→ 适配类绑定的上游令牌 → 名字视图 / 上游实例类型。
    const read = (): unknown => {
      const byToken = resolveService(ctx, token);
      if (byToken !== undefined) return byToken;
      // 只有令牌名对得上、类身份对不上：这是**严重装配错误**（非契约令牌 / 双实例），
      // 一律报错，不当成"同一个服务"用下去。
      const byName = resolveServiceByTokenName(ctx, name);
      if (byName !== undefined) {
        throw new Error(
          `inject() 只认契约身份：${name} 只按令牌名匹配到实现，说明装配里出现了非契约令牌或双实例`,
        );
      }
      if (boundToken !== undefined) {
        const byBound = resolveService(ctx, boundToken);
        if (byBound !== undefined) return byBound;
      }
      return namedServiceOf(ctx, item.token);
    };
    const found = read();
    if (found !== undefined && !isAdaptedPlaceholder(found)) {
      assign(item, found);
      continue;
    }
    if (meta?.serviceResolver !== undefined) {
      const value = meta.serviceResolver(ctx);
      if (value === undefined) {
        if (item.optional) {
          instance[item.key] = undefined;
          continue;
        }
        throw new Error(`service "${name}" is not available`);
      }
      unregisters.push(provideService(ctx, token, value));
      assign(item, value);
      continue;
    }

    // 提供者已经启动完成却没兑现令牌：装配错误当场报出来（带 provider 名），不要等成超时。
    if (provided) {
      if (item.optional) {
        instance[item.key] = undefined;
        continue;
      }
      throw new Error(
        `service "${name}" is not available; its provider "${meta?.impl.name ?? name}" provided nothing`,
      );
    }
    // optional 只在**装配里根本没有**这个令牌时给 undefined；有提供者、只是还没就位，就与必填一样等。
    if (item.optional && !planned) {
      instance[item.key] = undefined;
      continue;
    }
    // 我们自己的令牌（装配里会 provide 自己实例）如果本批既没提供者、也不在计划表，
    // 就永远等不到：装配错误当场报出来，不要拖成调用方的超时。
    if (
      host !== undefined &&
      !planned &&
      meta !== undefined &&
      meta.providesService === true &&
      meta.serviceClass === undefined
    ) {
      throw new Error(`service "${name}" is not available`);
    }

    const value = await waitFor(read, Date.now() + (host?.timeoutMs ?? DEFAULT_WAIT_MS));
    if (value === undefined) {
      // 同一观测点：解析为空时记下「必填还是可选」与令牌名。
      (ctx as { logger?: { debug?(format: string, ...args: unknown[]): void } }).logger?.debug?.(
        "[inject] %s ← undefined (%s)",
        name,
        item.optional ? "optional" : "required",
      );
      if (item.optional) {
        instance[item.key] = undefined;
        continue;
      }
      throw new Error(`service "${name}" is not available`);
    }
    assign(item, value);
  }
}

export function toPlugin(meta: TokenMeta, services: ServiceTable, config: unknown): Plugin {
  return {
    name: meta.name,
    async apply(ctx: CordisContext) {
      bindServiceTable(ctx, services);
      const { instance, pending } = construct(meta.impl, ctx, config);
      const unregisters: (() => void)[] = [];
      await resolvePending(ctx, instance, pending, unregisters);

      const unregister = meta.providesService
        ? provideService(ctx, meta.token, instance)
        : undefined;
      const unregisterAliases = (meta.aliases ?? []).map((alias) =>
        provideService(ctx, alias, instance),
      );
      await instance.onInit?.(ctx);
      return async () => {
        await instance.onDispose?.();
        await (instance as { disposeProvider?: () => unknown }).disposeProvider?.();
        for (const undo of unregisterAliases) undo();
        unregister?.();
        for (const unregisterService of unregisters.reverse()) unregisterService();
      };
    },
  };
}

export async function attachProvider(
  ctx: CordisContext,
  provider: Newable,
  config?: unknown,
): Promise<() => Promise<void>> {
  const meta = tryGetTokenMeta(provider);
  if (meta === undefined) {
    // 不是 zephyr Provider（没有 `@Injectable()`）：按上游 cordis 插件装载，config 原样交给它。
    // 同一棵 ctx 树共享服务表：插件里的 `provideToken` 才能落到行 ctx 上。
    bindServiceTable(ctx, serviceTableOf(ctx));
    const fiber = ctx.plugin(provider as unknown as PluginClass, config);
    await fiber;
    return async () => fiber.dispose();
  }
  // 单个 Provider 的入口也要建计划表：`inject` 在字段初始化时据此区分
  // 「装配里还没就位」与「装配里根本没有」（后者当场报错，不死等）。
  bindPlannedTokens(ctx, new Set<Token>([meta.token, ...(meta.aliases ?? [])]));
  const { instance, pending } = construct(meta.impl, ctx, config);
  const unregisters: (() => void)[] = [];
  await resolvePending(ctx, instance, pending, unregisters);

  console.error(
    "[attach.provide]",
    meta.name,
    "providesService=",
    meta.providesService,
    "adapted=",
    isAdapted(meta.impl),
    "token=",
    getTokenName(meta.token),
  );
  const unregister = meta.providesService ? provideService(ctx, meta.token, instance) : undefined;
  const unregisterAliases = (meta.aliases ?? []).map((alias) => provideService(ctx, alias, instance));
  await instance.onInit?.(ctx);
  return async () => {
    await instance.onDispose?.();
    await (instance as { disposeProvider?: () => unknown }).disposeProvider?.();
    for (const undo of unregisterAliases) undo();
    unregister?.();
    for (const unregisterService of unregisters.reverse()) unregisterService();
  };
}

/** 在同一行 ctx 上按声明顺序装配一组 Provider；逆序卸载。 */

export async function attachProviders(
  ctx: CordisContext,
  providers: ProviderList,
  config?: unknown,
): Promise<() => Promise<void>> {
  const flat = flattenProviders(providers);
  // 行装配与 bootstrapApplication 同一口径：optional 注入据此区分「还没就位」与「装配里没有」。
  bindPlannedTokens(ctx, plannedTokensOf(flat));
  // 并发装配：Provider 之间可以互相等待（顺序 await 会让「A 等 B、B 排在 A 后面」直接卡死）。
  // **按声明顺序串行装配**：`@Module` 的 imports/providers 顺序就是依赖顺序（上游先 init，下游后 init）。
  // 不并发、也不靠"等名字出现"——依赖关系在装配面已经给全了。
  const disposers: Array<() => Promise<void>> = [];
  for (const entry of flat) {
    if (typeof entry === "function") {
      disposers.push(await attachProvider(ctx, entry as Newable, config));
      continue;
    }
    if ("useFactory" in entry) {
      const factory = entry as FactoryProvider;
      const unregister = provideService(ctx, factory.provide, factory.useFactory(ctx));
      disposers.push(async () => {
        unregister();
      });
      continue;
    }
    if ("provide" in entry) {
      disposers.push(await attachProvider(ctx, entry.provide as Newable, entry.useValue ?? config));
      continue;
    }
    throw new Error("unsupported provider entry in toCordis providers");
  }
  return async () => {
    for (const dispose of [...disposers].reverse()) await dispose();
  };
}

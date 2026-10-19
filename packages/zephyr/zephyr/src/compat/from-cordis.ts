// 上游适配面：cordis 插件/服务适配成 Provider 或令牌。
import type { Context as CordisContext } from "@deepseek-ai/cordis";

import { callPluginWithInstance } from "../call-plugin.ts";
import { awaitServiceName, serviceInstanceOfType, provideService, publishServiceName, resolveService } from "../service-table.ts";
import { getTokenName, markAdapted, resolveToken } from "../token-meta.ts";
import { Injectable, namedServiceOf } from "../token.ts";
import type { Newable, Token } from "../injection.ts";
import { resolveConfigExprs } from "./js-expr.ts";
import type { PluginRef } from "../upstream-plugin.ts";
import type { Awaitable, Context, InjectedFiber } from "../injection.ts";
import { withConfig, type ConfigurableProvider } from "../provider.ts";
import { createServiceScope, kServiceScope, type ServiceScope } from "../service-scope.ts";


abstract class AdaptedBase<P extends PluginRef = PluginRef> {
  protected readonly upstream?: PluginRef;

  /** 契约令牌形式（`fromCordis(契约, 上游)`）默认自动 mount：消费方按契约注入，装配必须兑现令牌。 */
  protected readonly autoMount: boolean = false;

  protected async onInit(ctx: Context): Promise<void> {
    if (this.autoMount) await this.mount(ctx);
  }

  protected onDispose?(): Awaitable<void>;

  /** 上游插件 apply 返回的 disposer（由行生命周期的收尾调用）。 */
  disposeProvider?: () => unknown;

  /** 行作用域：卸载时把它的 effect 栈跑完（不再依赖 cordis 的 fiber）。 */
  providerScope?: ServiceScope;

  /** 上游 Service 类需要原生 `ctx.provide` 时开启（默认只进名字视图/令牌表）。 */
  /** 配置是否还要走上游 `Config` schema；Service 类适配时通常已拿到解析后的配置。 */
  protected readonly normalizeConfig: boolean = true;

  // 字段名避开 `config`：上游服务类普遍把配置存成同名私有成员
  // （`constructor(ctx: CordisContext, private config: Config)`），`AdaptedBase<P> & InstanceType<P>`
  // 里两个不同来源的同名 private/protected 成员会让这个交集求值为 never，适配类整个不可用。
  protected providerConfig: unknown;

  /** mount 使用的行 ctx（已注入依赖）：适配类在需要向上游注册名字时用它。 */
  // 行作用域：只给适配层内部的发布/卸载用（外部禁止访问）。
  private providerContext!: CordisContext;

  // 上游实例（`mount` 完成后可用）：适配行转发契约面的唯一来源。
  protected providerInstance: object | undefined;

  constructor(config: Partial<PluginConfig<P>> = {}) {
    this.providerConfig = config;
  }

  protected resolveConfig(ctx: CordisContext, defaults?: unknown): unknown {
    void ctx;
    // 合并顺序固定：实现类的默认配置 ← 装配面经 `withConfig` 绑定的覆盖。
    return { ...(defaults as object), ...(this.providerConfig as object) };
  }

  /**
   * 装配一行。
   * @param config **默认配置**（实现类就地写的那些）；构造时经 `withConfig` 绑定的 `providerConfig`
   *               是装配面的显式覆盖，**优先于它**。
   * @param deps   上游 `inject` 声明的依赖，随 mount 进本行作用域。
   */
  protected async mount(
    ctx: Context,
    config: Partial<PluginConfig<P>> = {},
    deps?: DepsOf<P>,
  ): Promise<void> {
    // 配置在 `onInit` 里**显式**传：真正生效点是 mount（生命周期统一）。
    // 合并结果只在本次 mount 用掉，**不回写** `providerConfig`（那是构造期绑定的装配输入）。
    const effectiveConfig = { ...(this.providerConfig as object), ...config };
    // `ctx` 可能是行作用域（`onInit(ctx)` 收到的那一层）：发布与 cordis 转发都要落到它背后的真实行 ctx。
    // 读 symbol 键对 cordis ctx 代理是安全的（普通属性读会按「未声明注入」报错）。
    const context =
      (ctx as unknown as Record<symbol, CordisContext | undefined>)[kServiceScope] ??
      (ctx as CordisContext);
    const upstream = this.upstream;
    if (upstream === undefined) {
      throw new Error("no upstream plugin bound; build the provider class with fromCordis()");
    }

    // 纯包装行（`mount(ctx)` 不传 deps，客户端行都是这种）：上游插件自己 `ctx.inject([...])` 等依赖，
    // 这里不要求 deps 覆盖 `inject`；只有「我们接管依赖」的适配行（传了 deps）才校验覆盖。
    // 只有「我们接管依赖」的适配行才校验：deps 缺省或为空都算纯包装行（上游自己 ctx.inject 等）。
    const hasDeps = deps !== undefined && Object.keys(deps).length > 0;
    const declaredNames = (upstream as { inject?: readonly string[] }).inject ?? [];
    const checkedDeps = hasDeps ? declaredNames : [];
    const missing = checkedDeps.filter((name) => !Object.hasOwn(deps as Record<string, unknown>, name));
    if (missing.length > 0) {
      // 依赖一律由适配类的字段 `inject(...)` 显式给出并随 mount 传入，不读上游 `static inject` 做隐式补齐。
      const name = (upstream as { name?: string }).name ?? "upstream plugin";
      throw new Error(
        `mount() of "${name}" is missing declared dependencies: ${missing.join(", ")}`,
      );
    }

    const local = new Map<string, unknown>(Object.entries(deps ?? {}));
    const published = new Map<string, unknown>();
    const ctor = (this as { constructor: Function }).constructor;
    const token = (resolveToken(ctor) ?? ctor) as Token;
    const unpublishAll: Array<() => void> = [];
    let disposer: (() => any) | undefined;
    let disposed = false;

    const providerCtx = createServiceScope(context, {
      local,
      // 上游插件按 `ctx.<service>` 读兄弟行发布的名字，读面是名字视图；未发布的名字照样抛错。
      readNames: true,
      // 适配行：上游插件按名字读兄弟服务，未就绪时由它自己的 `ctx.inject([...])` 等（不在这里抛错）。
      permissiveRead: true,
      declaredNames: new Set((upstream as { inject?: readonly string[] }).inject ?? []),

      // 上游 provide 的名字只留在本行（同一行内其它上游插件读得到）；根名字视图只由我们的契约名写。
      onProvide: (name, value) => {
        console.error(`[onProvide] ${name}`);
        published.set(name, value);
        return () => {
          published.delete(name);
        };
      },
    });

    this.providerContext = providerCtx as unknown as CordisContext;
    this.providerScope = providerCtx;
    // 卸载顺序：上游插件 disposer → 撤销发布（名字/原生槽位/令牌）→ 作用域 effect 栈。
    // 由行生命周期的收尾调用（runtime / attachProvider），不依赖 cordis effect。
    this.disposeProvider = async () => {
      if (disposed) return;
      disposed = true;
      disposer?.();
      for (const dispose of unpublishAll.reverse()) dispose();
      await providerCtx.fiber.dispose();
    };

    // 上游 `inject` 声明的依赖由装配顺序保证（`attachProviders` 按 `@Module` 的顺序串行）；
    // 这里只做**立即校验**：缺了就直接报错，不"等名字出现"。
    // 纯包装行（deps 缺省/为空）由上游自己 ctx.inject 等依赖，不在此校验。
    const checkedNames = hasDeps ? declaredNames : [];
    const depsRecord = (deps ?? {}) as Record<string, unknown>;
    // 依赖的三种给法都认：`mount` 的 deps（显式，驼峰 key）、根 ctx 的名字视图、本行已发布的名字。
    const missingNames = checkedNames.filter(
      (name) =>
        !Object.hasOwn(depsRecord, name) &&
        serviceNameOf(context, name) === undefined &&
        !published.has(name),
    );
    if (missingNames.length > 0) {
      throw new Error(
        `upstream "${String((upstream as { name?: string }).name)}" is missing declared dependencies: ${missingNames.join(", ")}`,
      );
    }
    // **必须 await**：对象插件的 `apply` 常是 async，它里面的 `ctx.provide` 要等它跑完才进 `published`。
    const called = await callPluginWithInstance(
      upstream,
      providerCtx as unknown as CordisContext,
      resolveConfigExprs(this.resolveConfig(context, effectiveConfig), providerCtx as unknown as CordisContext),
      this.normalizeConfig,
    );
    this.providerInstance = called.instance;
    const result = called.result;
    // 面来源：契约名同名的 provide 值（上游自己实现契约的那种）→ 上游实例 → 第一个 provide 值。
    // 卸载与令牌都指向这一个面对象：适配实例与 providerContext 不外露。
    const tokenName = getTokenName(token);
    // 面的来源按优先级：契约名同名的 provide 值（上游自己实现契约）→ 上游实例 → **唯一**一个 provide 值
    // （对象插件形态：它没有实例，能力就是那一次 provide）。多个 provide 时不猜，留给显式契约。
    const subject =
      published.get(tokenName) ??
      called.instance ??
      (published.size === 1 ? published.values().next().value : undefined);
    // `subject === undefined` 是合法场景（纯副作用插件：不 provide、无实例），跳过发布即可。
    if (subject !== undefined) {
      const contractOf = (this as unknown as { constructor: { token?: Token } }).constructor.token;
      const face = contractFaceOf(subject, upstream, this, contractOf ?? token);
      // 发布处断言：适配类的令牌只能指向**契约面**，不能是适配实例本身
      // （那会把 `providerContext`/`inject` 字段暴露给消费者，也解释了「面缺 rpc」）。
      if (face === this) {
        throw new Error(
          `适配 "${getTokenName(token)}" 的契约面误取了适配实例本身：subject 应当来自上游实例或它的 provide 值`,
        );
      }
      // 发布观测：同一令牌被两次发布（host/client 双提供者）或面退化成适配实例时，这条会直接显影。
      // 两端都看得见（node 走 stdout，浏览器只有 console）：装配观测点。
      console.error(
        `[provide] ${getTokenName(token)} subject=${published.has(tokenName) ? "published" : (called.instance === undefined ? "provide-only" : "instance")} faceIsAdapter=${String(face === this)}`,
      );
      unpublishAll.push(provideService(context, token, face));
      // 根名字视图里唯一由上游行贡献的名字就是契约名（`session-query` 这类），值指向同一个面对象。
      const rootCtx = ((context as unknown as { root?: CordisContext }).root ?? context) as CordisContext;
      unpublishAll.push(publishServiceName(rootCtx, tokenName, face));
    }
    if (typeof result === "function") {
      disposer = result;
    }
  }
}

/**
 * 契约面：上游实例（或其 provide 的实现对象）的 Proxy。
 * 白名单 = 实例自身键 + 原型链成员 + 上游 `inject` 声明的名字；取不到的一律 `undefined`。
 */
function contractFaceOf(
  subject: unknown,
  upstream: PluginRef,
  adapter?: object,
  token?: Token,
): unknown {
  if (typeof subject !== "object" || subject === null) return subject;
  const intrinsic = new Set<string>([
    // `constructor` 留给 `instanceof` / 适配占位判定（`isAdaptedPlaceholder` 读它）。
    "constructor",
    // 用 `getOwnPropertyNames` 而不是 `Object.keys`：上游用闭包/defineProperty 挂的成员（`interactions`/`rpc`
    // 这类）常常不可枚举，`Object.keys` 会漏掉，面上读不到。
    ...Object.getOwnPropertyNames(subject),
    ...prototypeChainNames(Object.getPrototypeOf(subject) as object | null),
    ...((upstream as { inject?: readonly string[] }).inject ?? []),
    // 契约原型上声明的成员：上游可能没有（`Slots.mountApp` 是我们合成进契约的），
    // 只有这些名字允许回落到适配实例，避免 `inject` 字段/装配内部成员混进契约面。
    ...contractMemberNames(token),
  ]);
  // 契约原型声明的成员**上游全都有**时，直接给上游实例（少一层 Proxy）：
  // 消费者拿到的就是实现本身，方法绑定/身份/可枚举性都与上游一致。
  const contractAll = contractMemberNames(token);
  const upstreamNames = new Set([
    ...Object.getOwnPropertyNames(subject),
    ...prototypeChainNames(Object.getPrototypeOf(subject) as object | null),
  ]);
  if (contractAll.every((name) => upstreamNames.has(name))) return subject;
  return new Proxy(subject, {
    get(target, property) {
      // 白名单是快照，但上游可能在 mount 之后往实例上补成员（挂载面这类）——它自己的键照样放行；
      // 隔离靠"上游没有的键一律 undefined"，不靠白名单把后来的成员挡掉。
      if (
        typeof property === "string" &&
        !intrinsic.has(property) &&
        !Reflect.has(target, property)
      ) {
        return undefined;
      }
      const fromUpstream = Reflect.get(target, property);
      // 上游没有这个成员、而它在白名单里（契约原型声明的）→ 回落到适配实例（`Slots.mountApp` 这类）。
      const value =
        fromUpstream !== undefined || adapter === undefined
          ? fromUpstream
          : Reflect.get(adapter, property);
      // 方法按实例绑定（消费者拿到的面可以脱开调用）；constructor 原样给，绑定会丢掉原型的 `instanceof`。
      if (typeof value !== "function" || property === "constructor") return value;
      return value.bind(fromUpstream !== undefined ? target : adapter);
    },
  });
}

/** 契约类原型上声明的成员名（不含 `Object.prototype`）。 */
function contractMemberNames(contract: Token | undefined): string[] {
  const proto = (contract as { prototype?: object } | undefined)?.prototype;
  return proto === undefined ? [] : prototypeChainNames(proto);
}

/** 原型链上的成员名（不含 `Object.prototype` 那一层）；每个适配行算一次。 */
function prototypeChainNames(proto: object | null): string[] {
  const names: string[] = [];
  for (
    let current = proto;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    names.push(...Object.getOwnPropertyNames(current));
  }
  return names;
}

import { serviceNameOf, waitCordisName } from "../call-plugin.ts";
export { awaitServiceNames, callPlugin } from "../call-plugin.ts";

/** 在行 ctx 的服务表里按上游服务类的实例类型找服务；找不到就轮询等它出现。 */
export function serviceOfType(
  ctx: CordisContext,
  serviceClass: Function,
): { name: string; value: unknown } | undefined {
  return serviceInstanceOfType(ctx, serviceClass);
}

export async function awaitCordisServiceOfType(
  ctx: CordisContext,
  serviceClass: Function,
  timeoutMs = 3000,
): Promise<{ name: string; value: unknown }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = serviceOfType(ctx, serviceClass);
    if (found !== undefined) return found;
    if (Date.now() >= deadline) {
      throw new Error(
        `cordis service of type "${serviceClass.name}" did not appear within ${timeoutMs}ms; ` +
          "cannot inject its adapter token",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface ServiceProxyOptions {
  local?: Map<string, unknown>;

  /** 上游 `inject` 声明过的名字：未就绪时读面放行 `undefined`（不抛）。 */
  declared?: readonly string[];

  onProvide?: (name: string, value: unknown) => () => void;

  /** `provide` 同时落到 Cordis 原生 ctx：dsh 行里的其它插件要按名字看到替换后的服务。 */
}

export function createServiceProxy(ctx: CordisContext, options: ServiceProxyOptions): CordisContext {
  const local = options.local ?? new Map<string, unknown>();

  // 读面：先看本行 deps/行内发布，再看行 ctx，最后回退根 ctx（兄弟行发布到根的服务，
  // 例如 `webStartup`、`storage` 这些由行插件发布到根的原生名）。
  const available = (name: string): unknown => {
    if (local.has(name)) return local.get(name);
    const own = serviceNameOf(ctx, name);
    if (own !== undefined) return own;
    return serviceNameOf(ctx.root as CordisContext, name);
  };
  const provide = (name: string, value: unknown) => {
    // Service 自己 `super()` 注册的原生名等 init 完成（onProvide 统一发布）；普通插件立即注册。
    local.set(name, value);
    const unregister = options.onProvide?.(name, value) ?? publishServiceName(ctx, name, value);
    return () => {
      local.delete(name);
      unregister();
    };
  };
  const get = (name: string, fallback?: unknown) => {
    const found = available(name);
    if (found !== undefined) return found;
    // 上游 `inject` 声明过的名字：还没就绪时放行 `undefined`，让它自己的 `ctx.inject([...], cb)` 等——
    // `Service` 类在**构造里**就会读这些名字（`api-gateway` 的 `connection` 就是这样），读面抛错会让整行起不来。
    if (options.declared?.includes(name) === true) return fallback;
    return fallback;
  };
  let proxy: CordisContext;
  const inject = (names: readonly string[], callback?: (ctx: CordisContext) => unknown) => {
    let disposed = false;
    const awaitName = async (name: string) => {
      if (available(name) !== undefined) return;
      // 一次等待 + 轮询重试（带 deadline）：不能忙等，否则会让同批 Provider 全部超时。
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        await Promise.race([
          awaitServiceName(ctx, name),
          waitCordisName(ctx, name),
          new Promise((resolve) => setTimeout(resolve, 20)),
        ]);
        if (available(name) !== undefined) return;
      }
    };
    const run = async () => {
      for (const name of names) {
        await awaitName(name);
        // 就位的值先落到本行 local 快照：回调里读 `ctx.<name>` 时不会再因为并发卸载而抛。
        const value = available(name);
        if (value !== undefined) local.set(name, value);
      }
      if (disposed) return undefined;
      return callback?.(proxy);
    };
    const fiber = run() as InjectedFiber;
    fiber.dispose = () => {
      disposed = true;
    };
    return fiber;
  };
  proxy = new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop === "provide") return provide;
      if (prop === "get") return get;
      if (prop === "inject") return inject;
      if (prop === "reflect") {
        const reflect = Reflect.get(target, prop, receiver) as object;
        return new Proxy(reflect, {
          get(reflectTarget, reflectProp, reflectReceiver) {
            if (reflectProp === "provide") return provide;
            const value = Reflect.get(reflectTarget, reflectProp, reflectReceiver) as unknown;
            return typeof value === "function" ? value.bind(reflectTarget) : value;
          },
        });
      }
      if (typeof prop === "string") {
        const named = available(prop);
        if (named !== undefined) return named;
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        if (prop === "then" || prop === "toJSON" || prop === "constructor") return undefined;
        // 名字视图里有就返回，没有就与行 ctx 同一语义：上游插件漏声明依赖必须当场暴露。
        throw new Error(`cannot get property "${prop}" without inject`);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as CordisContext;
  return proxy;
}

/** 读行 ctx 的令牌表（测试与适配层在装完之后取实例）。 */
export function resolveProvider<T>(ctx: CordisContext, token: Token<T>): T | undefined {
  const resolved = resolveService(ctx, token);
  if (resolved !== undefined) return resolved as T;
  return namedServiceOf(ctx, token) as T | undefined;
}

/**
 * 服务就绪钩子：令牌解析到值就回调一次（适配层唯一读取点），返回值用于注销。
 * 用轮询而不是 cordis 的名字 inject：令牌可能只有实例类型/resolver，没有可声明的服务名。
 */
export function onService<T>(
  ctx: Context,
  token: Token<T>,
  callback: (value: T) => void,
  intervalMs = 0,
): () => void {
  const full = providerContext(ctx);
  let disposed = false;
  const tick = (): void => {
    if (disposed) return;
    const value = resolveProvider(full as CordisContext, token);
    if (value !== undefined) {
      callback(value);
      return;
    }
    setTimeout(tick, intervalMs);
  };
  tick();
  return () => {
    disposed = true;
  };
}

/** 在行 ctx 上把一个值挂到令牌上（adapter 把内部单例暴露给 `inject(Token)` 用）。 */
export function provideToken<T>(ctx: CordisContext, token: Token<T>, value: T): () => void {
  return provideService(ctx, token, value);
}

/** @internal 只给适配层内部用：外部装配面禁止拿它当"越狱口"（用 `inject` + `mount` 表达依赖）。 */
function providerContext(ctx: Context): CordisContext {
  return createServiceProxy(ctx as CordisContext, {});
}

type InjectKeys<P> = P extends { inject: readonly (infer K extends string)[] } ? K : never;

export type DepsOf<P> = Record<InjectKeys<P>, unknown>;

type PluginConfig<P> = P extends { Config?: (value?: infer Input) => any }
  ? Partial<Exclude<Input, null>>
  : unknown;

type PluginService<P> = P extends abstract new (...args: never[]) => infer Service
  ? Service
  : unknown;

export type AdaptedClass<P extends PluginRef = PluginRef> = (abstract new (
  config?: PluginConfig<P>,
) => AdaptedBase<P> & PluginService<P>) &
  ConfigurableProvider & {
    readonly token: Token;
  };

export interface AdaptedOptions {
  /** 跳过上游 `Config` schema 归一化（配置已是解析后的形状）。 */
  normalizeConfig?: boolean;
}

function isAdaptedOptions(value: unknown): value is AdaptedOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    !("apply" in value) &&
    !("name" in value) &&
    !("Config" in value)
  );
}

export function fromCordis<P extends PluginRef>(
  plugin: P,
  options?: AdaptedOptions,
): AdaptedClass<P>;
export function fromCordis<P extends PluginRef>(
  token: Token,
  plugin: P,
  options?: AdaptedOptions,
): AdaptedClass<P>;
export function fromCordis(
  tokenOrPlugin: Token | PluginRef,
  pluginOrOptions?: PluginRef | AdaptedOptions,
  maybeOptions?: AdaptedOptions,
): AdaptedClass {
  const options =
    maybeOptions ?? (isAdaptedOptions(pluginOrOptions) ? pluginOrOptions : undefined);
  const tokenForm =
    maybeOptions !== undefined ||
    (pluginOrOptions !== undefined && !isAdaptedOptions(pluginOrOptions));
  const declared = tokenForm ? (tokenOrPlugin as Token) : undefined;
  const upstream = (tokenForm ? pluginOrOptions : tokenOrPlugin) as PluginRef;
  const adapted = class Adapted extends AdaptedBase {

    static readonly token = declared;

    static readonly adapted = true;

    static readonly providerName = (upstream as { name?: string }).name;

    static readonly serviceClass =
      typeof upstream === "function" ? (upstream as unknown as Function) : undefined;

    static readonly withConfig = withConfig;

    protected override readonly upstream = upstream;

    /** 带了契约令牌：框架负责把上游实例接管到契约上，不必每个适配类都手写 onInit 去 mount。 */
    protected override readonly autoMount = declared !== undefined;

    // Service 类自动接管原生服务名（`super(ctx, name)` 是它的标准注册方式，没有歧义）；
    // 函数插件自己 `ctx.provide(...)` 的服务名要不要落根是**接口决策**，由适配点显式声明。
    // 原生服务名要落到根 ctx 的，只有「上游是 Service 类」这一种：它的 `super(ctx, name)` 是标准注册方式。
    // 函数插件自己 `ctx.provide(...)` 的名字留在 zephyr 的名字视图里（同一份源码的两条解析路径也能对上）。

    protected override readonly normalizeConfig = options?.normalizeConfig ?? true;
  };
  markAdapted(adapted);
  return adapted as unknown as AdaptedClass;
}

/** 上游服务令牌：不挂载插件，只把行 ctx 上已有的 Cordis 服务（按实例类型）映射成强类型令牌。 */
export type ServiceClass<T> = abstract new (...args: any[]) => T;

export type CordisServiceToken<T> = Token<T> & {
  readonly serviceClass: ServiceClass<T>;
  /** 上游服务名；声明在 Service 类上，供 patch 行 inject 使用。 */
  readonly serviceName?: string;
};

/**
 * 把上游服务类适配成令牌：消费侧写 `web = inject(Web)`，`attachProvider` 在行 ctx 的服务表里
 * 按 `instanceof` 找到实例后登记到令牌表。上游服务已由 dsh 行装载时用它，不要再 `mount` 一份。
 */
export function fromCordisService<T>(serviceClass: ServiceClass<T>): CordisServiceToken<T>;
export function fromCordisService<T>(
  serviceClass: Function,
  resolver: (ctx: CordisContext) => T | undefined,
): CordisServiceToken<T>;
export function fromCordisService<T>(
  serviceClass: Function,
  resolver?: (ctx: CordisContext) => T | undefined,
): CordisServiceToken<T> {
  class AdaptedCordisService {
    static readonly serviceClass = serviceClass;

    static readonly serviceName = (serviceClass as { serviceName?: string }).serviceName;

    static readonly providerName = serviceClass.name;

    static readonly adapted = true;

    static readonly serviceResolver = resolver;
  }
  markAdapted(AdaptedCordisService);
  return Injectable()(
    AdaptedCordisService as unknown as Newable,
  ) as unknown as CordisServiceToken<T>;
}


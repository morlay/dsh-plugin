// Provider 条目与配置子类：装配数据的类型面。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import { getTokenName } from "./token-meta.ts";
import { Injectable } from "./token.ts";
import { resolveWithout } from "./provider-list.ts";
import type { ObjectPlugin, PluginRef } from "./upstream-plugin.ts";
import type { Newable, Token } from "./injection.ts";

export interface WithoutRef {
  readonly kind: "without";
  readonly entry: ProviderEntry;
  /** 省略时无条件剔除；给表达式时只把它写进 patch 的 disabled，运行期保留 Provider。 */
  readonly disabled?: unknown;
}

/** 裸 cordis 插件条目：行运行时等它声明的 `inject` 就绪后装载，不包成 Provider。 */
export type RawPluginEntry = ObjectPlugin | { readonly default: PluginRef };

/**
 * 一条装配声明。五支，各有唯一入口：
 *   - 类（`@Injectable()` 的 Provider / 裸 cordis 插件类）
 *   - `configure(X, patch)` 绑过配置的条目
 *   - `contribute(X, value)` 的 multi 贡献
 *   - `{ provide, useFactory }` 的工厂值
 *   - `without(...)` 的剔除标记
 * Module 不在这支 union 里：装配单位是 provider 清单，`@Module` 已删除。
 */
export type ProviderEntry =
  | Newable
  | ConfigProvider
  | FactoryProvider
  | MultiProvider
  | WithoutRef
  | RawPluginEntry;

export interface ConfigProvider<C extends Token = Token> {
  provide: C;
  useValue?: ProviderConfig<C>;
}

export interface FactoryProvider<C extends Token = Token> {
  provide: C;
  useFactory: (ctx: CordisContext) => TokenInstance<C>;
}

export interface MultiProvider<C extends Token = Token> {
  provide: C;
  useValue: TokenInstance<C>;
  multi: true;
}

type TokenInstance<C> = C extends Token<infer T> ? T : unknown;

/**
 * 实现的配置类型：取**构造函数的第一个参数**。
 *
 * 不能写成 `config?: infer Config`——那要求构造参数可选，`constructor(config: Cfg)` 这种必填形态
 * 会推成 `unknown`，`configure(X, patch)` 就失去了类型约束（`@ts-expect-error` 都失效）。
 */
export type ProviderConfig<C extends abstract new (...args: any[]) => any> =
  ConstructorParameters<C> extends [infer First, ...infer Rest]
  ? Rest extends readonly [infer Second, ...unknown[]]
    ? // 两参：cordis `Service` 子类的 `(ctx, config)`，配置是第二个
      Second
    : // 一参：普通 Provider 的 `(config)`
      First
  : unknown;

/**
 * 深 Partial：补丁可以只给嵌套对象的一部分字段（合并语义与它一致）。
 * 数组与标量整体替换，所以数组保持原类型——否则 `tags: []` 会被映射成一堆可选方法，反而匹配不上。
 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** 装配 feature：对 provider 清单的一处改动（Angular 的 `withXxx()` 同形）。 */
export type ProviderFeature = (providers: readonly ProviderEntry[]) => ProviderEntry[];

export type ConfiguredProviderClass<C extends abstract new (...args: never[]) => unknown = Newable> = C & {
  /** 这一份绑定的配置（`configure` 合并时读它）。 */
  readonly providerConfig: unknown;
  /** 令牌名。 */
  readonly providerName: string;
  /** 回溯到实现类（`configure` 按它定位清单里的条目）。 */
  readonly providerBase: C;
};

/**
 * 内部：返回绑定配置的 Provider 子类（`providers` 里放 class，容器负责 `new`）。
 * 配置绑在实现子类上，`@Injectable()` 仍解析到基类令牌——`inject(Base)` 的身份不变。
 * 对外只有 `configure()` 一个入口。
 */
function bindConfig<C extends Newable>(
  base: C,
  config: unknown,
  options: { resolve?: (config: unknown) => unknown } = {},
): ConfiguredProviderClass<C> {
  const resolved =
    options.resolve === undefined ? config : options.resolve(config);
  const Base = base as unknown as new (...args: unknown[]) => object;
  class Configured extends Base {
    static readonly providerConfig = config;

    static readonly providerName = getTokenName(base);

    /** 基类令牌：生成器用它回溯到实现类（构建期包名等元数据的入口）。 */
    static readonly providerBase = base;

    // 继承 Cordis Service 的 Provider 由 zephyr 传 `(ctx, config)`；其余只传配置。
    constructor(...args: unknown[]) {
      if (args.length >= 2) {
        super(args[0], args[1] === undefined ? resolved : args[1]);
        return;
      }
      super(args[0] === undefined ? resolved : args[0]);
    }
  }
  Injectable()(Configured as unknown as Newable);
  return Configured as unknown as ConfiguredProviderClass<C>;
}

/** 配置深合并：普通对象逐键递归，其余（数组 / 标量 / 类实例）整体替换。 */
function mergeConfig(base: unknown, patch: unknown): unknown {
  const baseObject = isPlainObject(base) ? base : undefined;
  const patchObject = isPlainObject(patch) ? patch : undefined;
  if (patchObject === undefined) return patch;
  const merged: Record<string, unknown> = { ...baseObject };
  for (const [key, value] of Object.entries(patchObject)) {
    merged[key] = mergeConfig(baseObject?.[key], value);
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/** 这个条目是不是「绑过配置的实现」（`bindConfig` 的产物）。 */
function isConfiguredEntry(entry: ProviderEntry): entry is ConfiguredProviderClass<Newable> {
  return typeof entry === "function" && Object.hasOwn(entry, "providerConfig");
}

/**
 * feature：给某个实现绑/合并配置（Angular 的 `withXxx(...)` 同形）。
 *
 * 作用在**清单**上：按实现类定位条目，把补丁与它已经绑定的配置深合并后替换；找不到就抛错。
 * 域包用它绑默认（`configure(Probe, DEFAULTS)([Probe, Extra])`），装配面用它改局部
 * （`provideProbe(configure(Probe, { server: { port: 2 } }))`）——同一个函数，两种位置。
 *
 * @param provider - 实现类。
 * @param patch - 只给差异的配置；嵌套对象逐键合并、数组整体替换。
 * @returns 一个 `(providers) => providers` 的 feature。
 * @throws 清单里没有这个实现时抛错（静默不生效比报错更难查）。
 */
export function configure<C extends Newable>(
  provider: C,
  patch: DeepPartial<ProviderConfig<C>>,
): ProviderFeature {
  return (providers) => {
    let matched = false;
    const next = providers.map((entry) => {
      const base = isConfiguredEntry(entry) ? entry.providerBase : entry;
      if (base !== provider) return entry;
      matched = true;
      const already = isConfiguredEntry(entry) ? entry.providerConfig : undefined;
      return bindConfig(provider, mergeConfig(already, patch));
    });
    if (!matched) {
      throw new Error(`configure(${provider.name}) 没有匹配的 provider：清单里没有这个实现`);
    }
    return next;
  };
}

/** Provider 列表里的剔除标记：运行期不注册；patch 里保留为 disabled 行。 */
function withoutRef(entry: ProviderEntry, disabled?: unknown): WithoutRef {
  return disabled === undefined ? { kind: "without", entry } : { kind: "without", entry, disabled };
}

/**
 * feature：把清单里的某个实现剔除（Angular 的 `without(...)` 同形）。
 *
 * 与 `configure(...)` 一样只接收清单、返回清单，所以 `provideXxx(...features)` 能直接组合它们。
 * @param entry - 要剔除的实现（类本身，或 `configure` 绑过配置的条目）。
 * @param disabled - 给表达式时只写进 patch 的 `disabled`，运行期保留（配置面开关）。
 * @returns 一个 `(providers) => providers` 的 feature。
 */
export function without(entry: ProviderEntry, disabled?: unknown): ProviderFeature {
  return (providers) => resolveWithout([...providers, withoutRef(entry, disabled)]);
}

/**
 * 域包装配函数：一份默认清单 + 调用方给的 features。
 *
 * 这是域包唯一要写的样板（一行），把「默认清单 + feature 组合」的实现留在框架里：
 * ```ts
 * export const provideSandbox = provide([configure(SandboxDefault, DEFAULTS), FsSandbox]);
 * ```
 * 装配面看到的是 `provideSandbox()` / `provideSandbox(configure(X, patch), without(Y))`。
 *
 * @param defaults - 域包的默认 provider 清单。
 * @returns `(...features) => ProviderEntry[]`，可直接当 `providers` 用。
 */
export function provide(
  defaults: ProviderList,
): (...features: ProviderFeature[]) => ProviderEntry[] {
  return (...features) =>
    features.reduce<ProviderEntry[]>(
      (providers, feature) => feature(providers),
      flattenProviders(defaults),
    );
}

/** 清单与条目的分界：`ProviderList` 是数组，其余是条目。 */
function isProviderList(entry: ProviderEntry | ProviderList): entry is ProviderList {
  return Array.isArray(entry);
}

export function flattenProviders(providers: ProviderList | ProviderEntry): ProviderEntry[] {
  const flat: ProviderEntry[] = [];
  for (const entry of Array.isArray(providers) ? providers : [providers]) {
    if (isProviderList(entry)) flat.push(...flattenProviders(entry));
    else flat.push(entry);
  }
  return flat;
}



/**
 * 清单合并：同一 token 的 Provider 后者覆盖前者；multi 与无名条目保持原样。
 *
 * 覆盖者占据**自己的声明位置**（先删后插）：装配顺序按声明顺序排同层依赖，
 * 覆盖者往往依赖后出现的服务（如 `StorageDomain` 覆盖成 rdb 后端，rdb 后端由后面的行提供）。
 */
export function contribute<C extends Token>(
  provide: C,
  useValue: TokenInstance<C>,
): MultiProvider<C> {
  return { provide, useValue, multi: true };
}

export type ProviderList = ReadonlyArray<ProviderEntry | ProviderList>;

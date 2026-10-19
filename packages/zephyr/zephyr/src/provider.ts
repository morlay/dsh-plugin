// Provider 条目与配置子类：装配数据的类型面。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import { getTokenName } from "./token-meta.ts";
import { Injectable } from "./token.ts";
import type { ObjectPlugin, PluginRef } from "./upstream-plugin.ts";
import type { ModuleClass, Newable, Token } from "./injection.ts";

export interface WithoutRef {
  readonly kind: "without";
  readonly entry: ProviderEntry;
  /** 省略时无条件剔除；给表达式时只把它写进 patch 的 disabled，运行期保留 Provider。 */
  readonly disabled?: unknown;
}

/** 裸 cordis 插件条目：行运行时等它声明的 `inject` 就绪后装载，不包成 Provider。 */
export type RawPluginEntry = ObjectPlugin | { readonly default: PluginRef };

export type ProviderEntry =
  | Newable
  | ModuleClass
  | ConfigProvider
  | FactoryProvider
  | MultiProvider
  | ModuleRef
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

export interface ModuleRef {
  useModule: ModuleClass;
}

type TokenInstance<C> = C extends Token<infer T> ? T : unknown;

export type ProviderConfig<C> = C extends abstract new (
  config?: infer Config,
) => any
  ? [Config] extends [never]
    ? unknown
    : Config
  : unknown;

export function withConfig<C extends abstract new (config?: any) => any>(
  this: C,
  config?: ProviderConfig<C>,
): ConfiguredProviderClass<C> {
  // 直接返回**绑定配置的子类**（而不是装配 entry）：`providers` 里放 class 是唯一形态，
  // 构造参数拿到 config，`fromCordis` 的适配行因此也能 `withConfig(...)`。
  return configuredProvider(this as unknown as Newable, config) as unknown as ConfiguredProviderClass<C>;
}

export type ConfiguredProviderClass<C extends abstract new (...args: never[]) => unknown = Newable> = C & {
  readonly providerConfig: unknown;
  readonly providerName: string;
};

/**
 * 返回绑定配置的 Provider 子类：`providers` 里放 class，容器负责 `new`。
 * 配置绑在实现子类上，`@Injectable()` 仍解析到基类令牌——`inject(Base)` 的身份不变。
 */
export function configuredProvider<C extends Newable>(
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

    /** 基类令牌：生成器用它查 `@Module.dsh.packages` 的构建期包名。 */
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

export interface ConfigurableProvider {
  withConfig<C extends abstract new (config?: any) => any>(
    this: C,
    config?: ProviderConfig<C>,
  ): ConfigProvider<C>;
}

export function contribute<C extends Token>(
  provide: C,
  useValue: TokenInstance<C>,
): MultiProvider<C> {
  return { provide, useValue, multi: true };
}

export type ProviderList = ReadonlyArray<ProviderEntry | ProviderList>;

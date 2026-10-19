import type { Context } from "@deepseek-ai/cordis";
import { resolveServiceName, serviceInstanceOfType } from "./service-table.ts";
import { createInjectPlaceholder, definitionFileOf, getTokenName, isAdapted, resolveToken, tryGetTokenMeta, kInjectableMeta, type TokenMeta } from "./token-meta.ts";
import type { Newable, Token } from "./injection.ts";

export interface InjectionToken<T> extends Token<T> {
  readonly description: string;
  /** 提供该值的 client 插件包（loader 装载顺序用）；缺省表示不用等任何包。 */
  readonly host?: string;
}

export interface InjectionTokenOptions {
  readonly host?: string;
}

export const InjectionToken: new <T>(
  name: string,
  options?: InjectionTokenOptions,
) => InjectionToken<T> = class {
  constructor(name: string, options: InjectionTokenOptions = {}) {
    const token = class {};
    Object.defineProperty(token, "name", { value: name });
    Object.defineProperty(token, "description", { value: name });
    Object.defineProperty(token, "serviceName", { value: name });
    if (options.host !== undefined) {
      Object.defineProperty(token, "host", { value: options.host });
    }
    // 令牌元数据：`bootstrapApplication` 靠它区分「令牌」与「上游插件类」（后者交给 cordis 装载）。
    Object.defineProperty(token, kInjectableMeta, {
      value: {
        token: token as never,
        name: name,
        impl: token as never,
        providesService: true,
        isValue: true,
      },
    });
    return token as unknown as InjectionToken<unknown>;
  }
} as unknown as new <T>(
  description: string,
  options?: InjectionTokenOptions,
) => InjectionToken<T>;

/** 类上的 `@Injectable()` 元数据（symbol 键）：原型链上已有就复用，继承者不会重复创建。 */

export function lookupInjectableMeta(target: Function): TokenMeta | undefined {
  for (let current: object | null = target; current !== null; current = Object.getPrototypeOf(current)) {
    const meta = (current as Record<symbol, unknown>)[kInjectableMeta];
    if (meta !== undefined) return meta as TokenMeta;
  }
  return undefined;
}

export function Injectable(): ClassDecorator {
  return ((target: Newable) => {
    const token = resolveToken(target);
    const suggested =
      token === undefined
        ? (target as { providerName?: string }).providerName
        : undefined;
    // 契约按语义命名（`SessionStore` / `TypertRegistry` / `Tools`），类名连字符化就是服务名。
    const name = suggested ?? getTokenName(token ?? target);

    const providesService = !isAdapted(target);
    const resolved = token ?? target;
    const serviceClass = (target as { serviceClass?: Function }).serviceClass;
    const serviceResolver = (
      target as { serviceResolver?: (ctx: Context) => unknown }
    ).serviceResolver;
    const file =
      (target as { providerFile?: string }).providerFile ?? definitionFileOf();
    const aliases = (target as { aliases?: readonly Token[] }).aliases;
    const meta: TokenMeta = {
      token: resolved,
      name,
      impl: target,
      providesService,
      ...(aliases === undefined ? {} : { aliases }),
      ...(serviceClass === undefined ? {} : { serviceClass }),
      ...(serviceResolver === undefined ? {} : { serviceResolver }),
      ...(file === undefined ? {} : { file }),
    };
    // 构建期生成器读它找类所属的包（行名不手写）；继承来的值不覆盖。
    if (file !== undefined && !Object.hasOwn(target, "providerFile")) {
      Object.defineProperty(target, "providerFile", { value: file });
    }
    Object.defineProperty(target, kInjectableMeta, { value: meta, configurable: true });

    if (resolved !== target && tryGetTokenMeta(resolved) === undefined) {
      Object.defineProperty(resolved, kInjectableMeta, { value: meta, configurable: true });
    }
    return target;
  }) as unknown as ClassDecorator;
}

export interface Inject {
  <T>(token: Token<T>): T;

  all<T>(token: Token<T>): T[];

  optional<T>(token: Token<T>): T | undefined;
}

// 适配类实例是占位：它的上游实例由 `mount()` 在 onProvide 时覆盖到同一令牌上。
export function isAdaptedPlaceholder(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    isAdapted((value as { constructor: Function }).constructor)
  );
}

// `inject()` 只登记「要什么」：构造完成后由 `resolvePending()` 统一解析（bootstrap 内部只有一个 ctx，
// 构造是同步的，不存在「当前注入上下文」这层隐式状态）。
export const inject: Inject = (<T>(token: Token<T>): T =>
  createInjectPlaceholder(token) as T) as Inject;

inject.all = function all<T>(token: Token<T>): T[] {
  return createInjectPlaceholder(token, false, true) as unknown as T[];
};

inject.optional = function optional<T>(token: Token<T>): T | undefined {
  return createInjectPlaceholder(token, true) as T | undefined;
};

// 令牌名就是宿主 ctx 的服务名（`InjectionToken("locale")` ↔ `ctx.locale`）：令牌没人登记时按名字回退，
// 聚合层就不再需要为每个 ctx 槽位再包一层 Provider。
export function namedServiceOf(ctx: Context, token: Token): unknown {
  // 上游抽象 Service 类本身就是令牌；`fromCordisService()` 生成的令牌把真实类型放在 `serviceClass`。
  if (typeof token === "function" && token.prototype !== undefined) {
    const serviceClass = (token as { serviceClass?: Function }).serviceClass ?? token;
    const found = serviceInstanceOfType(ctx, serviceClass);
    if (found !== undefined) return found.value;
  }
  const name = (token as { serviceName?: unknown }).serviceName;
  if (typeof name !== "string" || name.length === 0) return undefined;
  // 适配层（fromCordis）把上游服务名发布到 zephyr 的名字视图；先看这一份，再退回 cordis 原生槽位。
  const published = resolveServiceName(ctx, name);
  if (published !== undefined) return published;
  // 兄弟行把服务发布到根 ctx（隔离视图里看不到）：按名字回退根 ctx 再找一次。
  const root = (ctx as unknown as { root?: Context }).root;
  if (root !== undefined && root !== ctx) {
    const fromRoot = namedServiceOf(root, token);
    if (fromRoot !== undefined) return fromRoot;
  }
  try {
    const found = (ctx.reflect as { get(name: string): unknown }).get(name);
    // 适配类的占位实例（尚未 mount 出上游实例）不算「就位」：消费方要等真正的上游实例。
    if (
      found !== undefined &&
      found !== null &&
      isAdapted((found as { constructor: Function }).constructor)
    ) {
      return undefined;
    }
    return found;
  } catch {
    return undefined;
  }
}

// 令牌：契约类就是令牌，名字 = 类名连字符化（同时是 cordis 服务名与 dsh 行 id）。
import type { TokenClass } from "./injection.ts";

/** 令牌元数据：名字、是否多值、以及令牌本身。 */
interface TokenMeta {
  readonly token: Function | object;
  readonly name: string;
  readonly multi: boolean;
  /**
   * 上游服务名的别名（`@Injectable({ name })`）。
   *
   * 我们的派生名是连字符（`session-persistence`），而上游插件按**驼峰**读（`ctx.sessionPersistence`）。
   * 别名就是给这种情况用的：装配时按它再发布一份，上游那条严格读/`inject` 才拿得到。
   * 不写就只发派生名（与上游同名会撞的契约不要写）。
   */
  readonly alias?: string;
  /** 是不是 `InjectionToken`（没有实现类，只能由上游在 mount 期按名字发布）。 */
  readonly value?: boolean;
}

/** 注入占位：字段初始化时写入，装配阶段换成实例。 */
const kInject = Symbol.for("morlay.zephyr.inject");

/** 已登记的令牌：类 / InjectionToken 对象 → 元数据。 */
const registered = new Map<Function | object, TokenMeta>();

/** 名字 → 令牌。多值令牌不占单值名字。 */
const byName = new Map<string, Function | object>();

/**
 * 按名字取令牌（装配前检查用）。
 * @param name - 服务名。
 * @returns 令牌，或 `undefined`。
 */
export function tokenNamed(name: string): Function | object | undefined {
  return byName.get(name);
}

/** 注入占位符（内部类型）。 */
export interface InjectPlaceholder {
  readonly [kInject]: {
    readonly token: Function | object;
    readonly mode: "one" | "optional" | "all";
  };
}

/** `@Injectable()` 的选项。 */
export interface InjectableOptions {
  /** 多值令牌：由多个实现注册，注入端用 `inject.all`。 */
  readonly multi?: boolean;
  /** 显式指定令牌（适配行用：它的令牌是契约，不是生成出来的基类）。 */
  readonly token?: Function;
  /**
   * 上游服务名（与派生名并存，作为**别名**在装配时再发布一份）。
   *
   * 用于「上游按驼峰读、我们的派生名是连字符」的契约（`SessionPersistence` / `Setting`）。
   * 实现类继承契约时会带上它。
   */
  readonly name?: string;
}

/**
 * 把类登记成契约（令牌）。实现类继承契约时复用契约的令牌，不另立身份。
 * @param options - 多值标记。
 * @returns 类装饰器。
 */
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target) => {
    if (options.token !== undefined) {
      const owned = tokenMetaOf(options.token);
      registered.set(target, {
        token: options.token,
        name: owned.name,
        multi: options.multi === true || owned.multi,
        ...(owned.alias === undefined ? {} : { alias: owned.alias }),
        ...(owned.value === true ? { value: true } : {}),
      });
      return;
    }
    const inherited = findRegistered(Object.getPrototypeOf(target));
    if (inherited !== undefined && !options.multi) {
      // 实现类继承契约：同一个令牌，不另立身份，也不重复登记名字。
      registered.set(target, inherited);
      return;
    }
    const alias = options.name ?? inherited?.alias;
    const meta: TokenMeta = {
      token: inherited?.token ?? target,
      name: inherited?.name ?? hyphenate(target.name),
      multi: options.multi === true,
      ...(alias === undefined ? {} : { alias }),
    };
    registered.set(target, meta);
    if (!meta.multi) byName.set(meta.name, meta.token);
  };
}

/**
 * 纯值配置的令牌：没有服务类型的配置对象用它注入。
 * @param name - 服务名。
 * @param options - 多值标记。
 * @returns 令牌对象。
 */
export const InjectionToken = function InjectionToken<T>(
  name: string,
  options: { readonly multi?: boolean } = {},
): TokenClass<T> {
  const token = class {} as unknown as TokenClass<T>;
  const meta: TokenMeta = { token, name, multi: options.multi === true, value: true };
  registered.set(token, meta);
  if (!meta.multi) byName.set(name, token);
  return token;
} as {
  <T>(name: string, options?: { readonly multi?: boolean }): TokenClass<T>;
  new <T>(name: string, options?: { readonly multi?: boolean }): TokenClass<T>;
};

/** 必需注入的品牌：类型层据此收集"这棵树需要哪些令牌"。 */
declare const kRequired: unique symbol;

/** 带必需标记的注入值：运行时就是契约实例，符号字段只用于类型检查。 */
export interface Required<T> {
  readonly [kRequired]: T;
}

/**
 * 声明一个注入点。装配阶段换成实例；缺提供者时装配失败（运行期）或编译期就报错。
 * @param token - 契约。
 * @returns 注入占位（类型上是契约实例 + 必需标记）。
 */
export function inject<T>(token: TokenClass<T>): T & Required<T> {
  return placeholder(token, "one") as unknown as T & Required<T>;
}

inject.optional = function optional<T>(token: TokenClass<T>): T | undefined {
  return placeholder(token, "optional") as unknown as T | undefined;
};

inject.all = function all<T>(token: TokenClass<T>): T[] {
  return placeholder(token, "all") as unknown as T[];
};

/**
 * 一个注入点的占位对象。
 * @param token - 契约。
 * @param mode - 单值 / 可选 / 多值。
 * @returns 占位。
 */
function placeholder(
  token: Function | object,
  mode: "one" | "optional" | "all",
): InjectPlaceholder {
  return { [kInject]: { token, mode } };
}

/**
 * 判断一个字段值是不是注入占位。
 * @param value - 字段值。
 * @returns 占位信息，或 `undefined`。
 */
export function injectPlaceholderOf(value: unknown): InjectPlaceholder[typeof kInject] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Partial<InjectPlaceholder>)[kInject];
}

/**
 * 是不是 `InjectionToken`（没有实现类的值令牌）：这类只能由上游在 mount 期按名字发布，
 * 装配前预检不该因为"清单里没有对应条目"就拒绝它。
 * @param token - 令牌。
 * @returns 判断结果。
 */
export function isValueToken(token: object): boolean {
  return registered.get(token as Function | object)?.value === true;
}

/**
 * 这个类/对象是否已登记为令牌（`@Injectable` 或 `InjectionToken`）。
 * @param token - 待判断的值。
 * @returns 判断结果。
 */
export function hasTokenMeta(token: unknown): boolean {
  return (typeof token === "function" || typeof token === "object") && token !== null
    ? registered.has(token as Function | object)
    : false;
}

/**
 * 令牌的元数据：没有登记时按类名派生（契约的实例类型由类型系统保证）。
 * @param token - 令牌。
 * @returns 元数据。
 */
export function tokenMetaOf(token: Function | object): TokenMeta {
  const meta = registered.get(token);
  if (meta !== undefined) return meta;
  const derived: TokenMeta = {
    token,
    name: hyphenate((token as { name?: string }).name ?? ""),
    multi: false,
  };
  registered.set(token, derived);
  return derived;
}

/**
 * 沿原型链找最近的已登记契约：实现类继承契约时，令牌仍是契约。
 * @param ctor - 起始原型。
 * @returns 已登记的元数据，或 `undefined`。
 */
function findRegistered(ctor: unknown): TokenMeta | undefined {
  let current = ctor;
  while (typeof current === "function" && current !== Function.prototype) {
    const meta = registered.get(current);
    if (meta !== undefined) return meta;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

/** 适配行挂上的契约面（`fromCordis` 的产物）。 */
export const kFace = Symbol.for("morlay.zephyr.contract-face");

/** 标记：这个实例是适配行，契约面来自上游插件而不是它自己。 */
export const kAdapted = Symbol.for("morlay.zephyr.adapted");

/** 标记：适配行已经 `mount` 过（用来区分"忘了 mount"与"上游本来就不发布服务"）。 */
export const kMounted = Symbol.for("morlay.zephyr.mounted");

/** 插件对象上指回 Provider 类的标记。 */
export const kProvider = Symbol.for("morlay.zephyr.provider");

/**
 * 插件对象背后是不是 Provider（装配清单据此识别）。
 * @param value - 待判断的值。
 * @returns Provider 类，或 `undefined`。
 */
export function providerOfPlugin(value: unknown): Function | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<symbol, Function | undefined>)[kProvider];
}

/**
 * 行的名字：Provider 实现类的类名连字符化（dsh 行 id 与服务名可以不同）。
 * @param impl - 实现类。
 * @returns 行名。
 */
export function rowNameOf(impl: Function): string {
  return hyphenate(impl.name);
}

/**
 * `GreeterDefault` → `greeter-default`。
 * @param name - 类名。
 * @returns 服务名。
 */
function hyphenate(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

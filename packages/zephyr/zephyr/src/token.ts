// 令牌：契约类就是令牌，名字 = 类名连字符化（同时是 cordis 服务名与 dsh 行 id）。
import type { TokenClass } from "./injection.ts";

/** 令牌元数据：名字、是否多值、以及令牌本身。 */
interface TokenMeta {
  readonly token: Function | object;
  readonly name: string;
  /**
   * 令牌的**原始**名字（没被 `hyphenate` 转换过）：类令牌是类名，Symbol 令牌是它的 key/description。
   *
   * 报错文案要用它——只打派生名（`config-forms`）会让人以为是字面量拼写，查不到源码里的 `ConfigForms`。
   */
  readonly label: string;
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
  /**
   * 装配 scope：缺省（`undefined`）是应用根。
   *
   * 值是**声明方**定的分类键（symbol）：装配器据此把行分派到别处装，而不是装进应用根。
   * 这里只存不解释——"这个 scope 是什么意思"是声明方的词汇，装配器不认识。
   */
  readonly scope?: symbol;
}

/**
 * 令牌的原始名字（不转换大小写）。
 * @param token - 类令牌或 Symbol 令牌。
 * @returns 原始名字。
 */
function labelOf(token: Function | object | symbol): string {
  if (typeof token === "symbol") {
    return Symbol.keyFor(token) ?? token.description ?? token.toString();
  }
  return (token as { name?: string }).name ?? "";
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

/**
 * 运行期的替身 → 契约面：**本文件唯一一处**收窄。
 *
 * 为什么收不了在别处：DI 的接缝本身长这样——`inject()` 在装配前返回的是占位对象、
 * `InjectionToken` 造的是空类，两者都不是契约实例；而字段与令牌的类型**必须**是契约面
 * （调用方才能直接 `this.foo.bar()`、`inject(Foo)` 才能推出 `Foo` 的实例类型）。
 * 类型系统表达不了「这个值稍后会被换成 `T`」，所以这一跳留在这里、只留一次；
 * 其余地方（`provider` / `bootstrap` / 适配行）一律用真类型，不许借它绕过检查。
 * @param value - 运行期替身（占位对象或空类）。
 * @returns 同一个值，按契约面使用。
 */
function asContractFace<T>(value: object): T {
  return value as unknown as T;
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
  /**
   * 上游服务名（与派生名并存，作为**别名**在装配时再发布一份）。
   *
   * 用于「上游按驼峰读、我们的派生名是连字符」的契约（`SessionPersistence` / `Setting`）。
   * 实现类继承契约时会带上它。
   */
  readonly name?: string;
  /**
   * 装配 scope：缺省不写就是应用根。
   *
   * 值是**声明方**定的分类键（symbol）：装配器把带 scope 的行交还给宿主，在宿主指定的 ctx 上装
   * （agent 域的那条路是 `@AgentScoped()`）。装配器自己不解释这个值。
   */
  readonly scope?: symbol;
}

/**
 * 把类登记成契约（令牌）。实现类继承契约时复用契约的令牌，不另立身份。
 * @param options - 多值标记。
 * @returns 类装饰器。
 */
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target) => {
    // 没有"显式令牌"这一档：令牌只有两个来源——**继承契约**（`extends 契约`，含 `InjectionToken` 造的类）
    // 或本类自己（`@Injectable()` 声明一个契约）。适配行也是 `extends 契约`，不另立身份。
    const inherited = findRegistered(Object.getPrototypeOf(target));
    if (inherited !== undefined && !options.multi) {
      // 实现类继承契约：同一个令牌，不另立身份，也不重复登记名字。
      // scope 是**实现类自己**的装配位置，不写就沿用契约的（契约通常是 root）：所以带 scope 时复制
      // 一份，绝不就地改共享的元数据——那会让契约的 scope 跟着变。
      registered.set(target, withScope(inherited, options.scope));
      return;
    }
    const alias = options.name ?? inherited?.alias;
    const meta: TokenMeta = withScope(
      {
        token: inherited?.token ?? target,
        name: inherited?.name ?? hyphenate(target.name),
        label: inherited?.label ?? target.name,
        multi: options.multi === true,
        ...(alias === undefined ? {} : { alias }),
      },
      options.scope ?? inherited?.scope,
    );
    registered.set(target, meta);
    if (!meta.multi) {
      byName.set(meta.name, meta.token);
      // **别名也要进 `byName`**：`@Injectable({ name })` 声明的「上游服务名」靠 `tokenNamed(名字)` 被
      // `adoptNamedServices` 采纳（上游按名字发布的服务要在装配期映射成令牌）。只存 `meta.alias` 的话，
      // 那条映射永远查不到——于是消费方只能退回按名字读，或者造一个 `InjectionToken(name)` 当名字载体。
      if (meta.alias !== undefined) byName.set(meta.alias, meta.token);
    }
  };
}

/**
 * 把 `@Injectable` 声明的 scope 合到元数据上。
 *
 * 没写 scope 就沿用原值；值相同就复用同一个对象（契约与实现类共享元数据是常态）。写了不同的就
 * **复制**——元数据是共享的，就地改会让契约跟着变。
 * @param meta - 原元数据。
 * @param scope - 声明的 scope（可能为空）。
 * @returns 合过 scope 的元数据。
 */
function withScope(meta: TokenMeta, scope: symbol | undefined): TokenMeta {
  if (scope === undefined || meta.scope === scope) return meta;
  return { ...meta, scope };
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
  const token = asContractFace<TokenClass<T>>(class {});
  const meta: TokenMeta = { token, name, label: name, multi: options.multi === true, value: true };
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
  return asContractFace<T & Required<T>>(placeholder(token, "one"));
}

inject.optional = function optional<T>(token: TokenClass<T>): T | undefined {
  return asContractFace<T | undefined>(placeholder(token, "optional"));
};

inject.all = function all<T>(token: TokenClass<T>): T[] {
  return asContractFace<T[]>(placeholder(token, "all"));
};

/**
 * 造一个契约的**部分替身**：装配 / 测试里只实现被用到的那几个成员。
 *
 * `partial` 按 `T` 检查（成员名写错、签名不对当场报错），返回面是完整的 `T`——于是装配位不再需要
 * `X as never`（把令牌说成 `never`，等于关掉检查）或 `{…} as unknown as X`（双断言）。
 * 泛型从**令牌**取（`stub(Locale, {…})`）而不是写成 `stub<Locale>(…)`：`InjectionToken<Face>` 的类型是
 * 构造面，`stub<UiWorkspace>(…)` 的 `T` 会推成令牌本身，而不是它指向的面。
 * @param token - 契约令牌（只用来推 `T`，运行期不读）。
 * @param partial - 契约的部分实现：写哪些成员就检查哪些。
 * @returns 类型上是完整契约，运行期就是 `partial`。
 */
export function stub<T>(token: TokenClass<T>, partial: Partial<T>): T {
  // 唯一一处断言：`Partial<T>` → `T` 是**收窄**（`T` 本来就可赋给 `Partial<T>`），不是双断言。
  void token;
  return partial as T;
}

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
    // Symbol 令牌没有 `name`：用 `Symbol.keyFor` / `description` 拿它的原始名字。
    label: labelOf(token),
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
 * 行 ctx 上记的「装这一行的那个 ctx」（父级）。
 *
 * 装配器在行 ctx 上写它：**事件**绑在行 ctx 上（scope 精确到这一行），而适配行注册**服务**时用父 ctx
 * 当 owner fiber——同一个 scope 里的兄弟行沿 fiber 链才读得到，别的 scope 读不到。缺省（直接
 * `mount(ctx)`、没经装配器）回落 `ctx.root`，与既有行为一致。
 */
export const kRowOwner = Symbol.for("morlay.zephyr.row-owner");

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

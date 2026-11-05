// 装配清单：`provide([...])` 是声明，`configure` / `without` 是 feature。
import type { Newable } from "./injection.ts";
import { kProvider, providerOfPlugin, tokenMetaOf } from "./token.ts";

/**
 * Provider 类声明的 Config 的输出类型。
 *
 * 行配置就是它的 `Partial`——默认值由 `Config` 自己补，行只写差异。没有 `static Config` 的类给 `unknown`。
 */
export type ConfigOf<P> = P extends { Config: (input?: never) => infer O } ? O : unknown;

/** 深可选：对象逐键，数组与标量原样。 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** 一个 Provider 条目：默认按类构造；`configure` 之后带上 config。 */
export interface ClassProvider<P extends Newable<unknown> = Newable<unknown>> {
  readonly provide: P;
  readonly config?: DeepPartial<ConfigOf<P>> | undefined;
}

/** 现算一个值的条目。 */
export interface FactoryProvider {
  readonly provide: object;
  readonly useFactory: (ctx: unknown) => unknown;
}

/** 直接给一个值的条目。 */
export interface ValueProvider {
  readonly provide: object;
  readonly useValue: unknown;
}

/** `toCordis()` 的产物：一个普通 cordis 插件对象，但带着 Provider 标记。 */
export interface PluginProviderEntry {
  readonly name: string;
  readonly Config?: (input?: never) => unknown;
  readonly [kProvider]: Newable<unknown>;
  apply(...args: never[]): unknown;
}

/** 清单里可以写的东西。 */
export type ProviderEntry =
  | Newable<unknown>
  | ClassProvider
  | FactoryProvider
  | ValueProvider
  | PluginProviderEntry;

/** 一份清单：只放条目；`configure` / `without` 是调用方叠加的 feature，不进清单。 */
export type ProviderList = readonly ProviderEntry[];

/** 清单变换（`configure` / `without` 的产物）。 */
export interface ProviderFeature {
  readonly apply: (list: ProviderList) => ProviderList;
}

/**
 * 声明一份清单，并给出叠加 feature 的装配函数。
 *
 * 清单只放条目；默认配置用**第二个参数**的 `configure(...)` 表达——不写进清单、也不写成
 * `{ provide, config }`，这样 `configure` 能把实现类的 `static Config` 推导到 patch 上。
 * 调用方传的 feature 排在默认值之后，因此可以覆盖域默认值。
 * @param list - 条目清单。
 * @param defaults - 域默认 feature（`configure` / `without`）。
 * @returns `(...features) => 条目清单`。
 */
export function provide<const L extends ProviderList>(
  list: L,
  defaults: readonly ProviderFeature[] = [],
): (...features: ProviderFeature[]) => L {
  // 返回类型保留清单的字面量：`bootstrapApplication` 的编译期检查靠它认出每个条目的实例，
  // 退化成 `ProviderEntry[]` 会让所有注入判成"缺提供者"。feature 会增删条目，类型层沿用 `L`
  // 保守处理（与「`without()` 剔掉的条目仍算提供过」同一口径）。
  return (...features) =>
    [...defaults, ...features].reduce<ProviderList>(
      (current, feature) => feature.apply(current),
      list,
    ) as unknown as L;
}

/**
 * 给某个实现挂 config：按实现类定位条目，深合并后替换。
 * @param impl - 实现类。
 * @param patch - 配置补丁。
 * @returns 清单 feature。
 */
export function configure<P extends Newable<unknown>>(
  impl: P,
  patch: DeepPartial<ConfigOf<P>>,
): ProviderFeature {
  return {
    apply: (list) =>
      list.map((entry) => {
        if (entryOf(entry) !== impl) return entry;
        return { provide: impl, config: merge(configOf(entry), patch) };
      }),
  };
}

/**
 * 从清单里剔除某个实现。
 * @param impl - 实现类。
 * @returns 清单 feature。
 */
export function without(impl: Newable<unknown>): ProviderFeature {
  return { apply: (list) => list.filter((entry) => entryOf(entry) !== impl) };
}

/**
 * 条目对应的实现类（值 / 工厂条目取 `provide`）。
 * @param entry - 清单条目。
 * @returns 实现的构造面。
 */
export function entryOf(entry: ProviderEntry): Newable<unknown> {
  if (typeof entry === "function") return entry;
  const plugin = providerOfPlugin(entry);
  if (plugin !== undefined) return plugin as Newable<unknown>;
  return (entry as { provide: Newable<unknown> }).provide;
}

/**
 * 条目上已有的 config。
 * @param entry - 清单条目。
 * @returns config，或 `undefined`。
 */
export function configOf(entry: ProviderEntry): Record<string, unknown> | undefined {
  if (typeof entry === "function") return undefined;
  return "config" in entry ? (entry.config as Record<string, unknown> | undefined) : undefined;
}

/**
 * 条目的服务名（来自令牌元数据）。
 * @param entry - 清单条目。
 * @returns 服务名。
 */
export function entryNameOf(entry: ProviderEntry): string {
  return tokenMetaOf(entryOf(entry) as unknown as object).name;
}

/**
 * 深合并：对象逐键，数组整体替换。
 * @param base - 原有配置。
 * @param patch - 补丁。
 * @returns 合并结果。
 */
function merge(
  base: Record<string, unknown> | undefined,
  patch: unknown,
): unknown {
  // 非对象配置（数组、标量）整体替换：`configure` 的 patch 类型是 `DeepPartial<ConfigOf<Impl>>`，
  // 但实现类的 Config 也可能是数组（`ClientRows` 就是包名清单），按索引拆成对象会让下游拿到 `{}`。
  if (!isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = merged[key];
    merged[key] =
      isPlainObject(previous) && isPlainObject(value) ? merge(previous, value) : value;
  }
  return merged;
}

/**
 * 是否是普通对象（数组与类实例都不算）。
 * @param value - 待判断的值。
 * @returns 判断结果。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

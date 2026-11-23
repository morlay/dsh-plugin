// `toCordis`：把 Provider 转成 cordis 插件对象（dsh 行入口用它）。
import type { Context as CordisContext, Context, Newable } from "@morlay/zephyr";
import {
  injectPlaceholderOf,
  kProvider,
  rowNameOf,
  tokenMetaChainOf,
  tokenMetaOf,
} from "@morlay/zephyr";
import { mountRow } from "@morlay/zephyr";

/** `toCordis` 的产物：一个普通的 cordis 插件对象。 */
export interface CordisPluginEntry {
  readonly name: string;
  /**
   * 依赖的服务名（上游 Loader 据此**等依赖就绪再激活**本行）。
   *
   * 不声明它就等于要求「装配时所有服务已经在了」：dsh 的 Loader 会在依赖未就绪时直接
   * `apply`，注入当场抛「没有提供者」。
   */
  readonly inject: readonly string[];
  /** 本行发布的服务名（行名 + 契约的上游别名）：供组合器把「自己提供的」从 `inject` 里剔掉。 */
  readonly provides: readonly string[];
  readonly Config?: (input?: never) => unknown;
  readonly [kProvider]: Newable<unknown>;
  apply(ctx: CordisContext, config?: unknown): Promise<() => Promise<void>>;
}

/** `toCordis` 的选项。 */
export interface ToCordisOptions {
  /** 行的 Config 规范化函数（cordis 的 `Config`）。 */
  readonly Config?: (input?: never) => unknown;
}

/**
 * 把一个 Provider 转成 cordis 插件对象。
 * @param provider - Provider 类。
 * @param options - 行的 Config。
 * @returns cordis 插件对象。
 */
export function toCordis(
  provider: Newable<unknown>,
  options: ToCordisOptions = {},
): CordisPluginEntry {
  const entry: CordisPluginEntry = {
    name: rowNameOf(provider),
    inject: dependencyNamesOf(provider),
    provides: providesOf(provider),
    [kProvider]: provider,
    async apply(ctx: CordisContext, config?: unknown): Promise<() => Promise<void>> {
      const mounted = await mountRow(ctx as Context, provider, config);
      return async () => {
        await mounted.dispose();
      };
    },
  };
  return options.Config === undefined ? entry : { ...entry, Config: options.Config };
}

/**
 * 一个 Provider 的注入依赖（服务名，去重）。
 *
 * 依赖在**实例字段初始化**时写入（`inject(Token)` 返回占位），没有静态元数据可读；这里实例化一次
 * 把占位读出来，实例本身只用来看字段、不 mount（Provider 的构造只存配置与字段，不产生副作用）。
 *
 * @param provider - Provider 类。
 * @returns 依赖的服务名。
 */
function dependencyNamesOf(provider: Newable<unknown>): string[] {
  const names = new Set<string>();
  const draft = new provider() as Record<string, unknown>;
  for (const value of Object.values(draft)) {
    const placeholder = injectPlaceholderOf(value);
    if (placeholder === undefined) continue;
    const meta = tokenMetaOf(placeholder.token);
    // cordis 原生 logger 是 ctx 上的属性、不是服务：装配器直接从 ctx 装入（与多行装配同一条规则），
    // 放进 inject 会让 Loader 等一个永远不会出现在服务表里的名字。
    if (meta.name === "logger") continue;
    // 上游按驼峰读（`ctx.tools`），上游行的服务名就是别名；没有别名时才用我们的派生名。
    names.add(meta.alias ?? meta.name);
  }
  return [...names];
}

/** 本行发布的服务名：行名 + 契约的上游别名。 */
function providesOf(provider: Newable<unknown>): string[] {
  const names = new Set<string>([rowNameOf(provider)]);
  const meta = tokenMetaChainOf(provider);
  if (meta !== undefined) {
    names.add(meta.name);
    if (meta.alias !== undefined) names.add(meta.alias);
  }
  return [...names];
}

export { kProvider, providerOfPlugin } from "@morlay/zephyr";

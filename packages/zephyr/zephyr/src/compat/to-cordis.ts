// `toCordis`：把 Provider 转成 cordis 插件对象（dsh 行入口用它）。
import type { Context as CordisContext } from "../injection.ts";
import type { Context, Newable } from "../injection.ts";
import { kProvider, rowNameOf } from "../token.ts";
import { mountRow } from "../bootstrap.ts";

/** `toCordis` 的产物：一个普通的 cordis 插件对象。 */
export interface CordisPluginEntry {
  readonly name: string;
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
    [kProvider]: provider,
    async apply(ctx: CordisContext, config?: unknown): Promise<() => Promise<void>> {
      const mounted = await mountRow(ctx as unknown as Context, provider, config);
      return async () => {
        await mounted.dispose();
      };
    },
  };
  return options.Config === undefined ? entry : { ...entry, Config: options.Config };
}

export { kProvider, providerOfPlugin } from "../token.ts";

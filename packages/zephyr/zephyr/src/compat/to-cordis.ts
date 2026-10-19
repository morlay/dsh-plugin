// dsh 行装配面：Provider / Module 转成 cordis 插件行。
import type { Plugin } from "@deepseek-ai/cordis";
import { Context as CordisContext } from "@deepseek-ai/cordis";
import { getTokenMeta } from "../token-meta.ts";
import type { ModuleClass, Newable } from "../injection.ts";
import { moduleMetaOf, providersOfModule } from "../module.ts";
import type { ProviderList } from "../provider.ts";
import { attachProvider, attachProviders } from "../attach.ts";

export type DshPlugin = Plugin.Object & { name: string };

export interface ToCordisOptions {
  name?: string;
  Config?: Plugin.Object["Config"];
  /** 行内装配的 Provider 列表（同一份行 config 分发给它们）；缺省只装 `provider`。 */
  providers?: (config: unknown) => ProviderList;
}

export function toCordis(provider: Newable, options?: ToCordisOptions): DshPlugin;
/** 行即 Module：一个 @Module 的 providers / imports 批量装进同一行。 */
export function toCordis(module: ModuleClass, options?: ToCordisOptions): DshPlugin;
export function toCordis(target: Newable | ModuleClass, options: ToCordisOptions = {}): DshPlugin {
  const module = moduleMetaOf(target);
  if (module !== undefined) {
    return {
      name: options.name ?? target.name,
      ...(options.Config === undefined ? {} : { Config: options.Config }),
      async apply(ctx: CordisContext, config: unknown) {
        return attachProviders(ctx, providersOfModule(target), config);
      },
    };
  }

  const provider = target as Newable & { inject?: readonly string[] };
  const meta = getTokenMeta(provider);
  return {
    name: options.name ?? meta.name,
    // 浏览器侧由 cordis 装载（没有 zephyr 的 pending 解析）：类上声明的 `static inject` 要带出去，
    // 否则插件会在依赖就位前 apply，`inject(Slots)` 这类字段拿到 undefined、入口静默不注册。
    ...(provider.inject === undefined ? {} : { inject: provider.inject }),
    ...(options.Config === undefined ? {} : { Config: options.Config }),
    async apply(ctx: CordisContext, config: unknown) {
      if (options.providers !== undefined) {
        return attachProviders(ctx, options.providers(config));
      }
      return attachProvider(ctx, provider, config);
    },
  };
}

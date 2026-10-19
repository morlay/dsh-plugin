// 上游插件的装载接缝：按插件形状（类插件 / 函数插件 / 对象插件）调用它的 apply，并做 Config 归一。
// root 的 plugin runtime 与适配层都用它，所以它属于 root；compat 只 re-export。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import { awaitServiceName, resolveServiceName } from "./service-table.ts";
import type { ObjectPlugin, PluginClass, PluginRef } from "./upstream-plugin.ts";

const CORDIS_INIT_HOOKS = Symbol.for("cordis.initHooks");
const CORDIS_INIT = Symbol.for("cordis.init");

function normalizeConfig(plugin: PluginRef, config: unknown): unknown {
  const schema = (plugin as { Config?: (value?: any) => any }).Config;
  if (schema === undefined) return config;
  return schema(config ?? {});
}

/** `callPluginWithInstance` 的结果：`result` 是上游 disposer（可能是函数/对象/undefined）。 */
export interface CalledPlugin {
  readonly result: any;
  readonly instance?: object;
}

/** 与 `callPlugin` 相同，但把 `Service`/类的实例一并带出来（适配行转发契约面要用）。 */
export async function callPluginWithInstance(
  plugin: PluginRef,
  ctx: CordisContext,
  config: unknown,
  normalize = true,
): Promise<CalledPlugin> {
  const resolved = normalize ? normalizeConfig(plugin, config) : config;
  if (typeof plugin === "function") {
    const prototype = (plugin as { prototype?: object }).prototype;
    // 只有 `constructor` 的类（`class X extends Service { constructor(){} }`）也要按类装载——
    // 靠原型上的方法数判断会把它当"函数插件"调用，报 `Class constructor … cannot be invoked without 'new'`。
    const looksLikeClass = /^class\b/u.test(Function.prototype.toString.call(plugin));
    const isClass =
      prototype !== undefined &&
      (looksLikeClass ||
        Object.getOwnPropertyNames(prototype).some((key) => key !== "constructor") ||
        Object.getOwnPropertySymbols(prototype).length > 0);
    if (isClass) {
      const instance = new (plugin as PluginClass)(ctx, resolved) as unknown as Record<
        symbol,
        unknown
      >;
      for (const hook of (instance[CORDIS_INIT_HOOKS] ?? []) as never[]) (hook as () => void)();
      const result = await (instance[CORDIS_INIT] as (() => unknown) | undefined)?.call(instance);
      return { result, instance: instance as unknown as object };
    }
    return {
      result: await (plugin as unknown as (ctx: CordisContext, config?: unknown) => any)(
        ctx,
        resolved,
      ),
    };
  }
  return { result: await (plugin as ObjectPlugin).apply(ctx, resolved) };
}

export async function callPlugin(
  plugin: PluginRef,
  ctx: CordisContext,
  config: unknown,
  normalize = true,
): Promise<any> {
  return (await callPluginWithInstance(plugin, ctx, config, normalize)).result;
}

export function serviceNameOf(ctx: CordisContext, name: string): unknown {
  const named = resolveServiceName(ctx, name);
  if (named !== undefined) return named;
  try {
    return (ctx as { get?: (n: string) => unknown }).get?.(name);
  } catch {
    return undefined;
  }
}

export function waitCordisName(ctx: CordisContext, name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      (ctx as unknown as { inject(n: string[], cb: () => void): unknown }).inject([name], () =>
        resolve(),
      );
    } catch {
      resolve();
    }
  });
}

/** 按名字等一组上游服务；返回超时期仍未出现的名字（空数组表示全部就绪）。 */
export async function awaitServiceNames(
  ctx: CordisContext,
  names: readonly string[],
  timeoutMs = 3000,
): Promise<string[]> {
  const missing: string[] = [];
  for (const name of names) {
    if (serviceNameOf(ctx, name) !== undefined) continue;
    await Promise.race([
      Promise.race([awaitServiceName(ctx, name), waitCordisName(ctx, name)]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    if (serviceNameOf(ctx, name) === undefined) missing.push(name);
  }
  return missing;
}

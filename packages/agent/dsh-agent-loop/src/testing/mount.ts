// 把 zephyr 的 **Provider 清单**装到真 cordis ctx 上（测试用）。
//
// 上游 testkit 的做法是逐条 `ctx.plugin(上游插件)`；我们的装配单元是 `ProviderList`（条目可能是类，
// 也可能是 `{ provide, config }`）。这个工具把两者接上：按条目实例化、解析字段注入、把服务的
// **契约名与上游别名**都发到行的 fiber 上（行卸载时自动抬走）。
import type { ProviderList } from "@morlay/zephyr";
import { EventEmitter } from "@morlay/zephyr";
import { injectPlaceholderOf, tokenMetaOf } from "@morlay/zephyr/testing";

interface MountContext {
  plugin(entry: unknown, config?: unknown): PromiseLike<unknown> & { dispose(): Promise<void> };
  provide(name: string, value?: unknown): unknown;
  readonly reflect: ReflectFace;
}

interface ReflectFace {
  provide(name: string, value: unknown): void;
  get(name: string, strict?: boolean): unknown;
}

function reflectOf(ctx: unknown): ReflectFace {
  return (ctx as { reflect: ReflectFace }).reflect;
}

/** 一个已挂上 ctx 的行。 */
export interface MountedRow {
  readonly instance: object;
  dispose(): Promise<void>;
}

/**
 * 实例化一条 Provider 并挂到 ctx 上。
 * @param ctx - 目标上下文。
 * @param impl - Provider 类（`@Injectable()` 的实现或适配行）。
 * @param config - 行配置（交给它的 `static Config` 归一化）。
 * @returns 已挂的行（带 `dispose`）。
 */
export async function mountProvider<C>(
  ctx: unknown,
  impl: new (config?: C) => object,
  config?: C,
): Promise<MountedRow> {
  const normalizer = (impl as unknown as { Config?: (input?: unknown) => unknown }).Config;
  const normalized = typeof normalizer === "function" ? normalizer(config ?? {}) : config;
  const instance =
    normalized === undefined
      ? new (impl as unknown as new () => object)()
      : new (impl as unknown as new (config: unknown) => object)(normalized);
  const reflect = reflectOf(ctx);
  for (const key of Object.keys(instance)) {
    const holder = instance as Record<string, unknown>;
    const placeholder = injectPlaceholderOf(holder[key]);
    if (placeholder === undefined) continue;
    const meta = tokenMetaOf(placeholder.token);
    const alias = (meta as { alias?: string }).alias;
    const value =
      (alias === undefined || alias === meta.name ? undefined : reflect.get(alias, false)) ??
      reflect.get(meta.name, false) ??
      reflect.get(meta.name);
    if (value === undefined && placeholder.mode === "one") {
      throw new Error(`没有提供者：${meta.name}（${instance.constructor.name} 需要它）`);
    }
    holder[key] = placeholder.mode === "all" ? [] : value;
  }
  for (const key of Object.keys(instance)) {
    const value = (instance as Record<string, unknown>)[key];
    if (value instanceof EventEmitter) value.onInit(ctx as never);
  }
  const lifecycle = instance as { onInit?: (value: never) => unknown; onDispose?: () => unknown };
  const meta = tokenMetaOf(impl as unknown as object);
  const alias = (meta as { alias?: string }).alias;
  const pluginCtx = ctx as MountContext;
  const fiber = pluginCtx.plugin({
    name: meta.name,
    apply: async (child: unknown) => {
      await lifecycle.onInit?.(child as never);
      // 服务发在**装配根**上：`mountRows` 那套 spec 是按 `ctx.xxx` 读的，行作用域里发的
      // 实例在根上读不到（cordis 的服务可见性按提供它的 ctx 作用域算）。
      pluginCtx.provide(meta.name, instance);
      if (alias !== undefined && alias !== meta.name && reflect.get(alias, false) === undefined) {
        pluginCtx.provide(alias, instance);
      }
      return typeof lifecycle.onDispose === "function" ? () => lifecycle.onDispose?.() : undefined;
    },
  });
  await fiber;
  return {
    instance,
    dispose: async () => {
      await (fiber as unknown as { dispose(): Promise<void> }).dispose();
    },
  };
}

/**
 * 把一份 Provider 清单整装到 ctx 上（按清单顺序）。
 * @param ctx - 目标上下文。
 * @param providers - 条目清单（类或 `{ provide, config }`）。
 * @returns 已挂的行（逆序 `dispose` 即可卸载）。
 */
export async function mountProviders(ctx: unknown, providers: ProviderList): Promise<MountedRow[]> {
  const rows: MountedRow[] = [];
  for (const entry of providers) {
    if (typeof entry === "function") {
      rows.push(await mountProvider(ctx, entry as new () => object));
      continue;
    }
    const typed = entry as { provide?: unknown; config?: unknown };
    if (typeof typed.provide === "function") {
      rows.push(
        await mountProvider(ctx, typed.provide as new (config?: unknown) => object, typed.config),
      );
    }
  }
  return rows;
}

// 契约名 → 上游名：spec 按上游名读（`ctx.sessionProjections` / `ctx.sessionModes` …），
// 我们的服务按契约名注册，所以装完要把同一批实例再按上游名发一份。
const UPSTREAM_ALIASES: Readonly<Record<string, string>> = {
  // cordis 注册名（类名 hyphen 化）→ 上游别名（驼峰）
  "session-projection-store": "sessionProjections",
  "session-store": "sessions",
  "session-query": "sessionQuery",
  "agent-directory": "agents",
  "tool-registry": "tools",
  "system-prompt": "systemPrompt",
  "agent-loop": "agentLoop",
};

/**
 * 把已装好的服务按**上游名**再发一份（找不到就跳过，已有人占着也跳过）。
 * @param ctx - 已装好服务的上下文。
 */
export function bridgeContractToUpstream(ctx: unknown): void {
  const target = ctx as MountContext;
  const services = ctx as unknown as Record<string, unknown>;
  for (const [contract, upstream] of Object.entries(UPSTREAM_ALIASES)) {
    // 两边都读 **cordis 的服务表**：行把实例发在行 fiber 上（卸载随行走），
    // 这里只是把它按上游名再暴露一份给按别名读的 spec。
    if (services[upstream] !== undefined) continue;
    const value = services[contract];
    if (value !== undefined) target.provide(upstream, value);
  }
}

/**
 * 一次装配的收回：把已挂的行逆序拆掉。
 * @param rows - `mountProviders` 的产物。
 */
export async function disposeRows(rows: readonly MountedRow[]): Promise<void> {
  for (const row of [...rows].reverse()) await row.dispose();
}

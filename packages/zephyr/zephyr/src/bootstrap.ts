// 独立应用启动面：bootstrapApplication 与 App。
import { Context as CordisContext } from "@deepseek-ai/cordis";
import type { Fiber } from "@deepseek-ai/cordis";
import { bindServiceTable, serviceTableOf } from "./service-table.ts";
import { bindPlannedTokens } from "./service-plan.ts";
import { resolveService } from "./service-resolver.ts";
import { resolveToken, tryGetTokenMeta } from "./token-meta.ts";
import {
  createFactoryRuntime,
  createMultiRuntime,
  createPluginRuntime,
  createRowRuntime,
  orderRuntimes,
  type RowRuntime,
  type RuntimeHost,
} from "./runtime.ts";
import type { Newable, Token } from "./injection.ts";
import type { ProviderEntry, ProviderList } from "./provider.ts";
import { dedupeProviders, plannedTokensOf, resolveWithout } from "./provider-list.ts";
import { flattenProviders } from "./provider.ts";

import { construct } from "./attach.ts";
import { resolveMulti } from "./service-resolver.ts";
import { FiberStateCompat, getTokenName } from "./token-meta.ts";
import type { PluginClass, PluginRef } from "./upstream-plugin.ts";
import { type FactoryProvider, type RawPluginEntry } from "./provider.ts";

export interface App {
  /** 装配用的 cordis ctx（`bootstrapApplication` 内部创建的那个；消费方按名字读服务时用）。 */
  readonly ctx: CordisContext;

  get<T>(token: Token<T>): T;

  tryGet<T>(token: Token<T>): T | undefined;

  getAll<T>(token: Token<T>): T[];

  instantiate<T>(provider: Newable<T>): T;

  on<T>(type: string, listener: (payload: T) => void): () => void;

  dispose(): Promise<void>;
}

export interface BootstrapOptions {
  ctx?: CordisContext;

  providers?: ProviderList | ProviderEntry;

  timeoutMs?: number;
}

const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 3000;

/** 依赖行启动失败：保留提供者名字与原始原因，装配方据此报「谁真的坏了」。 */
class DependencyStartError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: unknown,
  ) {
    super(`provider "${provider}" failed to activate: ${errorMessage(reason)}`);
  }
}

async function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (reason === undefined || reason === null) return "unknown error";
  return JSON.stringify(reason) ?? "unknown error";
}

/** 第一个失败的 fiber（带原因）：`bootstrapApplication` 靠它立刻收工，而不是等所有 fiber 落定。 */
function firstFailureOf(
  fibers: readonly Fiber[],
  waits: readonly Promise<unknown>[],
): Promise<{ fiber: Fiber; reason: string }> {
  return new Promise((resolve) => {
    waits.forEach((wait, index) => {
      const fiber = fibers[index];
      if (fiber === undefined) return;
      void wait.catch((reason: unknown) => resolve({ fiber, reason: errorMessage(reason) }));
    });
  });
}

function isRawPlugin(entry: unknown): entry is RawPluginEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    !("provide" in entry) &&
    !("kind" in entry) &&
    ("apply" in entry || "default" in entry)
  );
}

export async function bootstrapApplication(options: BootstrapOptions): Promise<App> {
  const ctx = options.ctx ?? new CordisContext();
  // 同一棵 Cordis ctx 树共享一张服务表：每个 dsh 行各自 bootstrap，令牌仍能跨行解析。
  const services = serviceTableOf(ctx);
  bindServiceTable(ctx, services);
  const fibers: Fiber[] = [];
  const runtimes: RowRuntime[] = [];
  const pluginRuntimes: RowRuntime[] = [];
  const runtimeByToken = new Map<Token, RowRuntime>();
  // 同一份源码可能被两条解析路径载入（symlink 与真实路径）：类身份不同、令牌名一致。
  // 依赖解析与 `without` 同一口径——先按身份，找不到按令牌名兜底。
  const runtimeByName = new Map<string, RowRuntime>();
  const providerIndex = new Map<Token, number>();
  const timeout = options.timeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;

  const entries: ProviderEntry[] = [];
  for (const entry of resolveWithout(flattenProviders(options.providers ?? []))) {
    entries.push(entry);
  }

  const deduped = dedupeProviders(entries);
  entries.splice(0, entries.length, ...deduped);

  bindPlannedTokens(ctx, plannedTokensOf(entries));

  // multi 是装配数据：先登记，后建的 Provider 才能在构造期看到「这是多值令牌」并把 `inject.all` 读全。
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "multi" in entry && entry.multi === true) {
      const contribution = entry as { provide: Token; useValue: unknown };
      const runtime = createMultiRuntime(contribution.provide, contribution.useValue, ctx);
      runtimes.push(runtime);
      await runtime.start();
    }
  }

  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null && "multi" in entry && entry.multi === true) {
      continue;
    }
    if (isRawPlugin(entry)) {
      // 裸 cordis 插件：交给行运行时装载（等它声明的 `inject` 名字就绪再 apply），不包成 Provider。
      const plugin = ("default" in entry ? entry.default : entry) as PluginRef;
      const name = (plugin as { name?: string }).name ?? "plugin";
      pluginRuntimes.push(createPluginRuntime(plugin, ctx, name, timeout));
      continue;
    }
    if (typeof entry === "object" && entry !== null && "useFactory" in entry) {
      const factory = entry as FactoryProvider;
      providerIndex.set(factory.provide, runtimes.length);
      const runtime = createFactoryRuntime(factory.provide, factory.useFactory, ctx);
      runtimeByToken.set(factory.provide, runtime);
      runtimeByName.set(getTokenName(factory.provide), runtime);
      runtimes.push(runtime);
      continue;
    }
    const provider =
      typeof entry === "function"
        ? { provide: entry as Token, useValue: undefined }
        : (entry as { provide?: Token; useValue?: unknown });
    if (provider.provide === undefined) {
      throw new Error(`expected a Provider class, received ${typeof entry}`);
    }
    const meta = tryGetTokenMeta(provider.provide);
    if (meta === undefined) {
      // 上游 cordis 插件类（没有 zephyr 令牌）：交给 cordis 自己装载，`useValue` 就是它的 config。
      fibers.push(ctx.plugin(provider.provide as PluginClass, provider.useValue));
      continue;
    }
    providerIndex.set(meta.token, runtimes.length);
    for (const alias of meta.aliases ?? []) providerIndex.set(alias, runtimes.length);
    const runtime = createRowRuntime(meta, ctx, provider.useValue);
    runtimeByToken.set(meta.token, runtime);
    runtimeByName.set(meta.name, runtime);
    for (const alias of meta.aliases ?? []) runtimeByToken.set(alias, runtime);
    runtimes.push(runtime);
  }

  const host: RuntimeHost = {
    timeoutMs: timeout,
    async ensure(token) {
      const key = getTokenName(token);
      const runtime = runtimeByToken.get(token) ?? runtimeByName.get(key);
      if (runtime === undefined) return false;
      try {
        await runtime.start(host);
      } catch (error) {
        // 依赖行的失败要能被识别：装配方优先报「提供者自己」的错误，而不是被等待方的二次失败。
        throw new DependencyStartError(runtime.name, error);
      }
      return true;
    },
  };

  // 裸插件在后台等依赖就绪：它等的名字可能由下面的行发布，顺序 await 会互相卡死。
  const pluginWaits = pluginRuntimes.map((runtime) =>
    runtime.start(host).then(
      () => undefined,
      (error: unknown) => ({ runtime, error }),
    ),
  );

  // 同层行并行启动：行之间的依赖由 `ensure()` 保证先后，声明顺序不该决定「谁先等谁」。
  // 上游插件按服务名等兄弟行发布的晚到服务（`storage.backend.rdb` 这类运行期名字）时尤其需要。
  let disposed = false;
  /** 失败回滚：与 `dispose` 同序，但不依赖返回对象（失败时它还没构造）。 */
  const rollback = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    for (const runtime of [...pluginRuntimes].reverse()) await runtime.dispose();
    for (const runtime of [...runtimes].reverse()) await runtime.dispose();
  };
  const ordered = orderRuntimes(runtimes, providerIndex);
  const startFailures: { runtime: RowRuntime; error: unknown }[] = [];
  await Promise.all(
    ordered.map((runtime) =>
      runtime.start(host).catch((error: unknown) => {
        startFailures.push({ runtime, error });
      }),
    ),
  );
  if (startFailures.length > 0) {
    // 失败即回滚：已启动的 provider 逆序卸载，不留半个应用。
    await rollback();
    // 错误分两类（React/Vue 的 error boundary 同口径）：
    //   **根因**——provider 自己抛的原始错误，单独列、带消息；
    //   **级联**——只是"它依赖的 provider 挂了"，只标注依赖对象，不重复错误文本。
    const roots: string[] = [];
    const cascades: string[] = [];
    for (const { runtime, error } of startFailures) {
      if (error instanceof DependencyStartError) {
        cascades.push(`  ↳ ${runtime.name} 未启动（依赖 ${error.provider} 失败）`);
        continue;
      }
      roots.push(`  ✗ ${runtime.name}: ${errorMessage(error)}`);
    }
    const lines = [...new Set([...roots, ...cascades])];
    throw new Error(`providers failed to activate:\n${lines.join("\n")}`);
  }

  for (const failure of await Promise.all(pluginWaits)) {
    if (failure !== undefined) {
      throw new Error(
        `providers failed to activate:\n${failure.runtime.name}: ${errorMessage(failure.error)}`,
      );
    }
  }

  const waits = fibers.map((fiber) => fiber.await());
  const failures = new Map<Fiber, string>();
  // 「等」不能把「错」也等掉：只要有 fiber 抛错就立刻收工。若还去等全部落定，其余 fiber 可能正等一个
  // 永远不会就绪的依赖（它的提供者已经失败），真实原因就会被拖成超时——报出来的是「没就绪」，不是错。
  const settled = await settleWithin(
    Promise.race([
      Promise.allSettled(waits),
      firstFailureOf(fibers, waits).then((first) => {
        failures.set(first.fiber, first.reason);
        return [] as PromiseSettledResult<unknown>[];
      }),
    ]),
    timeout,
  );
  const timedOut = settled === null;

  settled?.forEach((result, index) => {
    const fiber = fibers[index];
    if (fiber && result.status === "rejected") failures.set(fiber, errorMessage(result.reason));
  });

  const unresolved = fibers.filter((fiber) => (fiber.state as number) !== FiberStateCompat.ACTIVE);
  if (unresolved.length) {
    const detail = unresolved
      .map((fiber) => {
        const reason =
          failures.get(fiber) ??
          (timedOut
            ? `did not become active within ${timeout}ms`
            : "still waiting; another provider failed to activate");
        return `${fiber.name}: ${reason}`;
      })
      .join("\n");
    throw new Error(`providers failed to activate:\n${detail}`);
  }

  return {
    ctx,
    get<T>(token: Token<T>): T {
      // `get(适配类)` 与 `get(它绑定的上游令牌)` 等价：适配类的令牌就是上游类。
      const bound =
        typeof token === "function" || typeof token === "string" ? resolveToken(token) : undefined;
      const service =
        resolveService(ctx, token) ??
        (bound === undefined || bound === token ? undefined : resolveService(ctx, bound));
      if (service === undefined) {
        throw new Error(
          `service "${getTokenName(token)}" is not available; check that its provider is registered`,
        );
      }
      return service as T;
    },
    tryGet<T>(token: Token<T>): T | undefined {
      return resolveService(ctx, token) as T | undefined;
    },
    getAll<T>(token: Token<T>): T[] {
      return resolveMulti(ctx, token) as T[];
    },
    instantiate<T>(provider: Newable<T>): T {
      return construct(provider, ctx).instance as T;
    },
    on<T>(type: string, listener: (payload: T) => void): () => void {
      const disposer = (
        ctx as unknown as {
          on(type: string, listener: (payload: unknown) => void): () => void;
        }
      ).on(type, listener as (payload: unknown) => void);
      return () => {
        disposer();
      };
    },
    async dispose() {
      // 幂等：失败回滚与调用方显式 dispose 可能都走这里，清理只跑一次。
      if (disposed) return;
      disposed = true;
      // 依赖方先卸载：裸插件等的是行发布的名字，行本身要留到插件收拾完。
      for (const runtime of [...pluginRuntimes].reverse()) await runtime.dispose();
      for (const runtime of [...runtimes].reverse()) await runtime.dispose();
      for (const fiber of [...fibers].reverse()) {
        await fiber.dispose();
      }
    },
  };
}

// 双端装配的**通用工厂**：host 与 client 是两个 `bootstrapApplication`、两个 ctx。
//
// 每个「前后端一起跑」的 spec 都写一遍「起 host → 起 client → 传执行面 → finally 两个 dispose」
// 只会写出四种略有差别、都容易漏 dispose 的版本。这里一次写对，spec 只声明两边的 providers。
//
// 唯一的桥是 `provideLocalRemote`：client 只持 `Remote`，调用落到 host 的 `RemoteHandlers.invoke`。
import { bootstrapApplication, type App, type ProviderEntry } from "@morlay/zephyr";
import { onTestFinished } from "vitest";
import { RemoteHandlers } from "../api-gateway/remote-handlers.contract.ts";
import { TypertGateway } from "../typert/gateway.contract.ts";
import { provideLocalRemote } from "./provide.ts";
import type { StreamOpener } from "./local-remote.ts";

/** 双端装配的声明。 */
export interface TwoSidedBoot {
  /** host 侧（后端）的 providers。 */
  readonly createHost: () => readonly ProviderEntry[];
  /**
   * client 侧（前端）的 providers；不传就只起 host。
   *
   * 参数是已起好的 host：需要走传输的用 `provideLocalRemote(...)` 接上，
   * 典型写法 `(host) => [...provideLocalRemote(hostInvokerOf(host)), ...clientRows]`。
   */
  readonly createClient?: (host: App) => readonly ProviderEntry[];
}

/** 起好的两个装配。 */
export interface TwoSided {
  /** 后端。 */
  readonly host: App;
  /** 前端（没声明 `createClient` 时是 `undefined`）。 */
  readonly client: App | undefined;
  /** 先 client 后 host，逆序卸载。 */
  dispose(): Promise<void>;
}

/**
 * 把一个 host 装配的端点执行面交给 client 的传输。
 * @param host - 已起好的 host app。
 * @returns `EndpointInvoker`。
 */
export function hostInvokerOf(host: App) {
  const handlers = host.get(RemoteHandlers);
  const gateway = host.tryGet(TypertGateway);
  return async (endpoint: string, payload: Readonly<Record<string, unknown>>) => {
    // 路由与线上同一口径：自研 `@RemoteGroup` 在 `RemoteHandlers` 里，上游 `@Remote` 服务
    // （`terminal/*`、`settings/*` 这些适配行）在 typert 网关上。少了后一条，全链路用例只能看见自研组。
    if (handlers.has(endpoint)) return handlers.invoke(endpoint, payload);
    if (gateway === undefined) return handlers.invoke(endpoint, payload);
    const result = await gateway.dispatchWire(endpoint, { args: payload }, AbortSignal.timeout(30_000), {
      kind: "host",
    } as never);
    if (result.ok) return result.value;
    throw new Error(`[remote] ${endpoint} 失败：${result.error.code}：${result.error.message}`);
  };
}

/**
 * 把一个 host 装配的**流式**执行面交给 client 的传输（`workspace/follow` / `session/control` 这类）。
 * @param host - 已起好的 host app。
 * @returns `(endpoint, payload, signal) => 帧序列`。
 */
export function hostStreamOpenerOf(host: App): StreamOpener {
  const handlers = host.get(RemoteHandlers);
  const gateway = host.tryGet(TypertGateway);
  return (endpoint, payload, signal) => {
    const source = handlers.stream(endpoint, payload, signal);
    if (source !== undefined) return source;
    if (gateway !== undefined) return upstreamStreamOf(gateway, endpoint, payload, signal);
    throw new Error(`[remote] ${endpoint} 没有流式实现：检查对应的服务有没有注册它`);
  };
}

/**
 * 上游（typert 注册的）流式端点：网关按 descriptor 打开，帧原样往下给。
 * @param gateway - host 的 typert 网关。
 * @param endpoint - `<namespace>/<method>`。
 * @param payload - wire 的命名参数。
 * @param signal - 取消信号。
 * @returns 帧序列。
 */
function upstreamStreamOf(
  gateway: TypertGateway,
  endpoint: string,
  payload: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const [namespace, method] = endpoint.split("/");
  return {
    [Symbol.asyncIterator]: () =>
      (async function* frames(): AsyncGenerator<unknown> {
        const stream = await gateway.stream({
          endpoint: { namespace: String(namespace), method: String(method) },
          args: payload,
          signal,
          peer: { kind: "host" },
        } as never);
        for await (const frame of stream) yield frame;
      })(),
  };
}

/**
 * `bootTwoSided` 的收尾钩子。
 *
 * 传 `appEnv` 的 spec 直接把它当第二参数给（`bootTwoSided({…}, appEnv)`）：它的 `onCleanup` 就是清理链。
 */
export interface TwoSidedHooks {
  /**
   * 清理链登记口（`appEnv.onCleanup`）。
   *
   * 有它时**不**用 `onTestFinished`：vitest 里 fixture 的清理跑在 `onTestFinished` 之前（实测）。
   * 那样卸载发生在临时目录被删之后，dispose 期间的落盘会把 `sessions/` 写回已删除的根。
   */
  readonly onCleanup?: (fn: () => Promise<void>) => void;
}

/**
 * 起 host（可选再起 client），返回可 `dispose` 的两端。
 * @param boot - 两边的 providers。
 * @param hooks - 收尾钩子（带 `appEnv` 的 spec 直接传它）。
 * @returns 装配结果。
 */
export async function bootTwoSided(boot: TwoSidedBoot, hooks?: TwoSidedHooks): Promise<TwoSided> {
  const host = await bootstrapApplication({ providers: boot.createHost() });
  let client: App | undefined;
  if (boot.createClient !== undefined) {
    client = await bootstrapApplication({ providers: boot.createClient(host) });
  }
  const dispose = async (): Promise<void> => {
    await client?.dispose();
    await host.dispose();
  };
  // 自动收：spec 里不用写 try/finally，也不会漏。
  //
  // **有清理链就走清理链**：`appEnv.onCleanup` 在「删临时目录」之前跑，而 `onTestFinished` 在之后
  // （fixture 清理早于它，实测）。顺序反了的话，dispose 的落盘会写回已删除的根，留下
  // `zephyr-spec-*/sessions/…` 残骸。没带 `appEnv` 的 spec（自造根）退回 `onTestFinished`。
  if (hooks?.onCleanup !== undefined) hooks.onCleanup(dispose);
  else onTestFinished(dispose);
  return { host, client, dispose };
}

/** client 侧的 providers 快捷方式：把 unary 与**流式**两个执行面都接到 host 上。 */
export function clientWithTransport(
  host: App,
  extra: readonly ProviderEntry[],
): readonly ProviderEntry[] {
  return [
    ...provideLocalRemote(hostInvokerOf(host), hostStreamOpenerOf(host)),
    ...extra,
  ];
}

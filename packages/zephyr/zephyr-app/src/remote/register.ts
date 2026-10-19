// 把一组 `@RemoteGroup` / `@Remote` 声明注册到 wire 上。
//
// 声明在类上（组名 + 方法名），注册在这里（一次调用），所以服务端不必手写
// `handlers.register("commands/list", …)` 这种字符串——名字只有一个 home：契约。
import type { RemoteHandlers } from "../api-gateway/remote-handlers.contract.ts";
import { remoteGroupNameOf, remoteMethodsOf, remoteStreamMethodsOf } from "./decorators.ts";

/** wire 的命名参数 → 方法实参：有 `request` 那一层就剥掉，否则整个 args 就是请求。 */
function requestOf(args: Readonly<Record<string, unknown>>): unknown {
  return (args as { request?: unknown }).request ?? args;
}

/**
 * 注册一个 `@RemoteGroup` 实例的全部方法（unary 走 `register`，`mode: "stream"` 走 `registerStream`）。
 * @param handlers - 宿主侧 handler 表。
 * @param instance - 带 `@RemoteGroup` 的实现实例（方法上标了 `@Remote`）。
 * @returns 撤销注册的函数。
 */
export function registerRemoteGroup(handlers: RemoteHandlers, instance: object): () => void {
  const group = remoteGroupNameOf(instance.constructor);
  if (group === undefined) {
    throw new Error(
      `${instance.constructor.name} 没有 @RemoteGroup：远程注册需要组名（契约上用 { name } 声明）。`,
    );
  }
  const streamMethods = new Set(remoteStreamMethodsOf(instance.constructor));
  const disposers = remoteMethodsOf(instance.constructor).map((method) => {
    const handler = (instance as unknown as Record<string, unknown>)[method];
    if (typeof handler !== "function") {
      throw new Error(`${instance.constructor.name}.${method} 标了 @Remote 但没有实现`);
    }
    const endpoint = `${group}/${method}`;
    if (streamMethods.has(method)) {
      // 流式：宿主逐帧写 `item`，取消信号由 wire 的流承载给——方法自己接第二个参数。
      return handlers.registerStream(endpoint, (args, signal) =>
        (handler as (request: unknown, signal: AbortSignal) => AsyncIterable<unknown>).call(
          instance,
          requestOf(args),
          signal,
        ),
      );
    }
    return handlers.register(endpoint, async (args) => {
      // unary：wire 的调用形状是 `{ request }`；没有这一层时把整个 args 当请求，返回值原样透传。
      return await (handler as (request: unknown) => Promise<unknown>).call(instance, requestOf(args));
    });
  });
  return () => {
    for (const dispose of disposers) dispose();
  };
}

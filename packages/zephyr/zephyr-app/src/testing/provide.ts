// 进程内传输：**客户端半**的 `Remote` 实现，执行面由 host 装配传进来。
//
// 两套运行时是两个 ctx：host 装配提供 `RemoteHandlers`，client 装配只持 `Remote`，
// 这里就是两者之间唯一的桥（线上换成 wire，形状不变）。
//
// 不要在这里顺手把 host 的 `RemoteHandlersDefault` 也装进来——那是 host 装配的事；
// 同 ctx 装两份，`sessions` 这类同名不同义的服务就会互相抢。
import type { ProviderEntry } from "@morlay/zephyr";
import { LocalRemote, type EndpointInvoker, type StreamOpener } from "./local-remote.ts";

/**
 * client 侧的进程内传输：`Remote` 的实现是 `LocalRemote`，调用落到 host 的两个执行面。
 *
 * 按**类行**装（不是 `useValue`）：`LocalRemote` 的 `onInit` 要拿行 ctx 才能把 `remote.<namespace>`
 * 发布成嵌套服务名——上游好几行的 `static inject` 里写着它（`remote.job` / `remote.commands`），
 * 名字不在 store 里它们的 fiber 永远停在待激活。
 * @param call - host 装配的 unary 执行面（`RemoteHandlers.invoke`）。
 * @param openStream - host 装配的流式执行面（`RemoteHandlers.stream`）；不传就只有 unary 可用。
 * @returns providers 清单（直接展开即可）。
 */
export function provideLocalRemote(
  call: EndpointInvoker,
  openStream?: StreamOpener,
): readonly ProviderEntry[] {
  // `config` 就是构造函数那**一个**实参：两个执行面装在一个对象里（类行的造法只有一种）。
  return [{ provide: LocalRemote, config: { call, ...(openStream === undefined ? {} : { openStream }) } }] as readonly ProviderEntry[];
}

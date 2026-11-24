// 进程内传输：**客户端半**的 `Remote` 实现，执行面由 host 装配传进来。
//
// 两套运行时是两个 ctx：host 装配提供 `RemoteHandlers`，client 装配只持 `Remote`，
// 这里就是两者之间唯一的桥（线上换成 wire，形状不变）。
//
// 不要在这里顺手把 host 的 `RemoteHandlersDefault` 也装进来——那是 host 装配的事；
// 同 ctx 装两份，`sessions` 这类同名不同义的服务就会互相抢。
import type { ProviderEntry } from "@morlay/zephyr";
// 用**公开出口**取契约：调用方也是从 `@morlay/zephyr-app/contract` 拿 `Remote`，
// 相对路径与包名解析在测试环境里可能落成两个模块实例（令牌就对不上了）。
import { Remote } from "@morlay/zephyr-app/contract";
import { LocalRemote, type EndpointInvoker } from "./local-remote.ts";

/**
 * client 侧的传输替身：只提供 `Remote`，调用落到 `call`（host 装配的 `RemoteHandlers.invoke`）。
 * @param call - host 装配的端点执行面。
 * @returns providers 清单（直接展开即可）。
 */
export function provideLocalRemote(call: EndpointInvoker): readonly ProviderEntry[] {
  return [{ provide: Remote, useValue: new LocalRemote(call) }] as readonly ProviderEntry[];
}

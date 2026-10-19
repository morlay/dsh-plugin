// 测试用的**进程内传输**：`remote.upstream.<group>.<method>` 直接打到本进程的 handler 表。
//
// 形状与线上完全一致（上游面就是 `upstream[group][method]`），换的只是「怎么到达宿主」：
// 线上是 wire，这里是函数调用。所以业务测试可以用它跑完整条链路，只把传输换成假的。
//
// `upstream` 是动态代理，不写死任何 namespace —— 装了哪些 `@RemoteGroup` 就能走哪些组。
import { inject, Injectable } from "@morlay/zephyr";
import { RemoteHandlers } from "../api-gateway/remote-handlers.contract.ts";
import { Remote } from "../remote/remote.contract.ts";

/** 客户端半：`remote.upstream.<group>.<method>(request)` → `handlers.invoke("<group>/<method>", { request })`。 */
@Injectable()
export class LocalRemote extends Remote {
  private readonly handlers = inject(RemoteHandlers);

  readonly upstream: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get: (_target, group) =>
      new Proxy(
        {},
        {
          get: (_methods, method) => (request?: unknown) =>
            this.handlers.invoke(`${String(group)}/${String(method)}`, { request }),
        },
      ),
  });

  async $mount(): Promise<() => Promise<void>> {
    return async () => {};
  }

  async whenMounted(): Promise<void> {}

  async whenNamespace(): Promise<void> {}

  $on(): () => void {
    return () => {};
  }

  $stream(): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    throw new Error("LocalRemote 不支持流式方法：需要流的用例请用真 transport");
  }
}

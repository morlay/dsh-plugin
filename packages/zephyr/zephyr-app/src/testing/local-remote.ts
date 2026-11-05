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
/** 一条远端方法描述（`TYPERT_REMOTE.descriptors` 的最小子集）。 */
interface LocalDescriptor {
  readonly namespace?: string;
  readonly method?: string;
}

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

  /**
   * 登记一份绑定：把每个 descriptor 变成 `remote.<namespace>.<method>` 上的转发。
   *
   * **不能是空实现**：消费方（`ui-permission` 的目录）在装配期就读 `remote.permissionPresets.catalog`，
   * 空实现会让它拿到 `undefined`、报错点漂到上游内部（`reading 'catalog'`）。
   * @param contribution - `TYPERT_REMOTE` 之类的绑定。
   * @returns 卸载函数（撤掉这次登记的命名空间）。
   */
  async $mount(contribution: unknown): Promise<() => Promise<void>> {
    const descriptors = (contribution as { descriptors?: readonly LocalDescriptor[] } | undefined)?.descriptors ?? [];
    const added: string[] = [];
    for (const descriptor of descriptors) {
      const namespace = String(descriptor.namespace);
      const method = String(descriptor.method);
      const slot = this as unknown as Record<string, Record<string, (request?: unknown) => Promise<unknown>>>;
      const face = slot[namespace] ?? {};
      face[method] = async (request?: unknown): Promise<unknown> =>
        this.handlers.invoke(`${namespace}/${method}`, { request });
      slot[namespace] = face;
      added.push(namespace);
    }
    return async () => {
      const slot = this as unknown as Record<string, unknown>;
      for (const namespace of added) delete slot[namespace];
    };
  }

  /**
   * 直接调一个端点（`@RemoteClient()` 生成的转发走这里）：与 wire 同一个形状——`{ request }` 进来、
   * 原样结果出去。
   * @param endpoint - `<namespace>/<method>`。
   * @param args - wire 的命名参数。
   * @returns 宿主处理器的返回值。
   */
  async invoke(endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.handlers.invoke(endpoint, args);
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

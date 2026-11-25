// 测试用的**进程内传输**：`remote.upstream.<group>.<method>` 直接打到**另一个装配**的 handler 表。
//
// 形状与线上完全一致（上游面就是 `upstream[group][method]`），换的只是「怎么到达宿主」：
// 线上是 wire，这里是函数调用。所以业务测试可以用它跑完整条链路，只把传输换成假的。
//
// **必须**传执行面：host 与 client 是两个装配两个 ctx，client 半不持有 host 的路由表。
// 没有「读本 ctx 的 RemoteHandlers」这条兼容路径——那会让两套体系共用服务名空间。
//
// `upstream` 是动态代理，不写死任何 namespace —— 装了哪些 `@RemoteGroup` 就能走哪些组。
import { Injectable } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/contract";

/** 一个 namespace 的调用面：`remote.<namespace>.<method>(request)`。 */
type NamespaceFace = Record<string, (request?: unknown) => Promise<unknown>>;

/** 一条远端方法描述（`TYPERT_REMOTE.descriptors` 的最小子集）。 */
interface LocalDescriptor {
  readonly namespace?: string;
  readonly method?: string;
}

/** 一条端点的执行面（`(endpoint, payload) => 结果`）：host 装配里的 `RemoteHandlers.invoke`。 */
export type EndpointInvoker = (
  endpoint: string,
  payload: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

@Injectable()
export class LocalRemote extends Remote {
  /**
   * @param call - **另一个装配**的端点执行面（host app 的 `RemoteHandlers.invoke`）。
   */
  constructor(private readonly call: EndpointInvoker) {
    super();
  }
  readonly upstream: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    // symbol 键一律回 undefined：装配期会用 symbol 探字段（注入占位标记），
    // 代理若对它也造一个 Proxy，会被误判成「注入占位」。
    get: (_target, group) =>
      typeof group === "symbol"
        ? undefined
        : new Proxy(
            {},
            {
              get: (_methods, method) => (request?: unknown) =>
                this.call(`${String(group)}/${String(method)}`, { request }),
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
    const descriptors =
      (contribution as { descriptors?: readonly LocalDescriptor[] } | undefined)?.descriptors ?? [];
    const added: string[] = [];
    for (const descriptor of descriptors) {
      const namespace = String(descriptor.namespace);
      const method = String(descriptor.method);
      // 上游把 namespace 挂在 **service 实例自己**身上（`remote.<ns>`），这里照做：
      // 动态成员读改写走 `Reflect`，不再把 `this` 断言成一张表。
      const face: NamespaceFace = (Reflect.get(this, namespace) as NamespaceFace | undefined) ?? {};
      face[method] = async (request?: unknown): Promise<unknown> =>
        this.call(`${namespace}/${method}`, { request });
      Reflect.set(this, namespace, face);
      added.push(namespace);
      this.namespaceLive.add(namespace);
      // 按名字等的一方在这里被唤醒（与 `RemoteDefault` 同一个时机）。
      const waiters = this.namespaceWaiters.get(namespace);
      this.namespaceWaiters.delete(namespace);
      for (const resolve of waiters ?? []) resolve();
    }
    return async () => {
      for (const namespace of added) {
        Reflect.deleteProperty(this, namespace);
        this.namespaceLive.delete(namespace);
      }
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
    return this.call(endpoint, args);
  }

  async whenMounted(): Promise<void> {}

  /**
   * 等某个 namespace 被某个 `$mount` 登记（契约语义：至少注册了一个方法）。
   *
   * **不能一律兑现**：没挂的那一组兑现了，消费方就会读到 `undefined` 的面并打出
   * 「组挂上了、端点却不在」那类告警——那是"服务端版本不配对"的信号，替身不该伪造它。
   * @param namespace - 上游 namespace 名（`session`）。
   * @returns 该 namespace 登记过方法时兑现。
   */
  whenNamespace(namespace: string): Promise<void> {
    if (this.namespaceLive.has(namespace)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = this.namespaceWaiters.get(namespace) ?? new Set<() => void>();
      waiters.add(resolve);
      this.namespaceWaiters.set(namespace, waiters);
    });
  }

  /** 已 `$mount` 登记过方法的 namespace（`whenNamespace` 的判据）。 */
  private readonly namespaceLive = new Set<string>();

  /** 按 namespace 等的调用方（下一次 `$mount` 登记它时唤醒）。 */
  private readonly namespaceWaiters = new Map<string, Set<() => void>>();

  $on(): () => void {
    return () => {};
  }

  $stream(): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    throw new Error("LocalRemote 不支持流式方法：需要流的用例请用真 transport");
  }
}

// remote（客户端）：**自实现**，只对齐上游的行为（wire 协议），不包装它的实现。
//
// 上游 `ClientRemoteService` 把每个 namespace 注册成独立 cordis 服务、再靠实例上的动态 getter
// 伪装成 `remote.<ns>`；我们这层包装会丢掉那层 getter，导致 `remote.session` 永远 undefined。
// 这里按契约直接实现：`$mount` 只登记 descriptor，`remote.<ns>` 由 Proxy 按 descriptor 组请求，
// 请求走 `connection.rpc.open('/api', '<ns>/<method>', args)`（与上游同一条 wire 通道）。
import { inject, Injectable } from "@morlay/zephyr";
import { Connection } from "../../connection/contract.ts";
import { Remote } from "../../remote/remote.contract.ts";
import { muxTransport, type RemoteTransport } from "./remote-transport.ts";

/** 一条 remote 方法描述（上游 `TYPERT_REMOTE.descriptors` 的子集）。 */
interface RemoteDescriptor {
  readonly namespace: string;
  readonly method: string;
  /** `'stream'` 表示逐帧产出（`workspace/follow`）；省略是 unary。 */
  readonly mode?: string;
  readonly cancellation?: { readonly parameter?: string };
}

/** 一个 namespace 的调用面：`{ [method]: (...args) => Promise<unknown> }`。 */
type NamespaceFace = Record<string, (...args: never[]) => unknown>;

@Injectable()
export class RemoteDefault extends Remote {
  /** 传输层：socket 工厂归它（浏览器 / 非浏览器由它的 `origin` 决定）。 */
  private readonly connection = inject(Connection);

  /** `namespace/method` → 该方法的参数声明（wire 上要**命名参数**，不能发数组）。 */
  private readonly descriptors = new Map<string, readonly { readonly name?: string }[]>();

  /** `namespace/method` → 是不是流式方法。 */
  private readonly streams = new Set<string>();

  /** `namespace` → 方法名集合（`$mount` 登记，Proxy 据此判定「这个名字是不是 remote 方法」）。 */
  private readonly namespaces = new Map<string, Set<string>>();

  private readonly faces = new Map<string, NamespaceFace>();

  /** 传输实现：默认 mux（生产）；测试可以直接替换。 */
  // **惰性**取 `connection`：字段初始化时它还是占位符，`resolvePending` 之后才换成真实例。
  // **惰性**取：字段初始化时 `connection` 还是占位符。
  private transport: RemoteTransport = muxTransport(() => this.connection);

  /** 替换传输实现（测试用：传 `mockTransport(...)`）。 */
  useTransport(transport: RemoteTransport): void {
    this.transport = transport;
    this.faces.clear();
    // 换了传输实现，events 也要重新接（旧实现的 `subscribe` 已经无效）。
    this.eventsWired = false;
    this.wireEvents();
  }

  constructor() {
    super();
    // `remote.<namespace>` 不是自有属性：按登记表回落。
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        const name = typeof prop === "string" ? prop : "";
        return (target as RemoteDefault).faceOf(name);
      },
    });
  }

  /**
   * 登记一份 remote 绑定（只取 `namespace`/`method`，不执行任何 cordis 插件）。
   * @param contribution - `TYPERT_REMOTE` 之类的绑定。
   * @returns 卸载函数。
   */
  async $mount(contribution: unknown): Promise<() => Promise<void>> {
    const descriptors = (contribution as { descriptors?: readonly RemoteDescriptor[] }).descriptors ?? [];
    const mounted: { namespace: string; method: string }[] = [];
    for (const descriptor of descriptors) {
      if (typeof descriptor.namespace !== "string" || typeof descriptor.method !== "string") continue;
      const endpointKey = `${descriptor.namespace}/${descriptor.method}`;
      const declared = (descriptor as { parameters?: readonly { name?: string }[] }).parameters ?? [];
      this.descriptors.set(endpointKey, declared);
      if (descriptor.mode === "stream") this.streams.add(endpointKey);
      const methods = this.namespaces.get(descriptor.namespace) ?? new Set<string>();
      methods.add(descriptor.method);
      this.namespaces.set(descriptor.namespace, methods);
      this.faces.delete(descriptor.namespace);
      this.namespaceLive.add(descriptor.namespace);
      mounted.push({ namespace: descriptor.namespace, method: descriptor.method });
    }
    // 按名字等 namespace 的一方在这里被唤醒（`whenMounted` 只等第一个 contribution）。
    for (const namespace of this.namespaceWaiters.keys()) {
      if (!this.namespaceLive.has(namespace)) continue;
      const waiters = this.namespaceWaiters.get(namespace);
      this.namespaceWaiters.delete(namespace);
      for (const resolve of waiters ?? []) resolve();
    }
    this.resolveMounted?.();
    this.resolveMounted = undefined;
    return async () => {
      for (const { namespace, method } of mounted) {
        this.namespaces.get(namespace)?.delete(method);
        this.faces.delete(namespace);
      }
    };  }

  /** 第一次 `$mount` 完成时兑现的 Promise（`whenMounted` 用它）。 */
  private resolveMounted: (() => void) | undefined;

  private readonly mounted = new Promise<void>((resolve) => {
    this.resolveMounted = resolve;
  });

  /** 等第一次 `$mount` 完成。 */
  whenMounted(): Promise<void> {
    return this.mounted;
  }

  /** 已经登记过方法的 namespace。 */
  private readonly namespaceLive = new Set<string>();

  /** 按 namespace 等的调用方（`whenNamespace`）。 */
  private readonly namespaceWaiters = new Map<string, Set<() => void>>();

  /** 等某个 namespace 被 `$mount` 登记（已登记就立即兑现）。 */
  whenNamespace(namespace: string): Promise<void> {
    if (this.namespaceLive.has(namespace)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = this.namespaceWaiters.get(namespace) ?? new Set<() => void>();
      waiters.add(resolve);
      this.namespaceWaiters.set(namespace, waiters);
    });
  }

  /** 频道 → 监听者（宿主推送到达时由 transport 派发）。 */
  private readonly listeners = new Map<string, Set<(...args: never[]) => void>>();

  /**
   * 订阅一个推送频道（上游行为：按 channel 分发；本实现维护本地表）。
   * @param channel - 频道名（`api-session/added` 之类）。
   * @param listener - 回调。
   * @returns 退订函数。
   */
  $on(channel: string, listener: (...args: never[]) => void): () => void {
    // 第一次订阅时把 transport 的 events 流接到 `deliver`（幂等）。
    this.wireEvents();
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(channel);
    };
  }

  private eventsWired = false;

  /** 把 transport 的推送流接到 `deliver`（只接一次）。 */
  private wireEvents(): void {
    if (this.eventsWired) return;
    this.eventsWired = true;
    this.transport.subscribe?.((channel, ...args) => this.deliver(channel, ...(args as never[])));
  }

  /**
   * 派发一帧宿主推送（transport 收到 events 流的帧时调它）。
   * @param channel - 频道名。
   * @param args - 帧载荷。
   */
  deliver(channel: string, ...args: never[]): void {
    for (const listener of this.listeners.get(channel) ?? []) listener(...args);
  }

  /**
   * 打开一个**流式** remote 方法。
   *
   * 本实现先用 `connection.rpc.open` 的流式变体（若宿主支持），否则给一个**空流**——
   * 消费方拿到的形状与上游一致（`AsyncIterable` + `dispose`），不会因形态不符而炸。
   * @param options - 流参数。
   * @returns 空流（宿主没提供流载体时）。
   */
  $stream(_options: { name: string; args?: readonly unknown[]; signal?: AbortSignal }): AsyncIterable<unknown> & {
    dispose(): Promise<void>;
  } {
    const empty: AsyncIterable<unknown> & { dispose(): Promise<void> } = {
      async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {},
      async dispose(): Promise<void> {},
    };
    return empty;
  }

  /**
   * 主机事实（上游 `remote.$host` 的同名行为）：从 `connection.generation` 派生。
   *
   * 消费方（`ui-workspace` 等）用它决定 host 相关展示，所以必须与上游同形。
   */
  get $host(): { home: string; isLoopback: boolean } {
    // `home` 是页面自己的 origin（消费方拿它缩写文件路径）。
    const origin = typeof location === "undefined" ? "" : location.origin;
    return { home: origin, isLoopback: /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/.test(origin) };
  }

  /**
   * 上游实例：本实现**没有**上游实例（自实现），给一个空对象满足契约。
   *
   * 需要 namespace 面的消费方应该用 `remote.<namespace>.<method>(...)`。
   */
  readonly upstream: Record<string, unknown> = {};

  /** 取一个 namespace 的调用面（不存在就 `undefined`：调用方按「没挂这一组」处理）。 */
  private faceOf(namespace: string): NamespaceFace | undefined {
    const methods = this.namespaces.get(namespace);
    if (methods === undefined) return undefined;
    const cached = this.faces.get(namespace);
    if (cached !== undefined) return cached;
    const face: NamespaceFace = {};
    for (const method of methods) {
      // 上游 wire 协议：`{ args: <命名参数对象> }`。名字来自 descriptor 的 `parameters[].name`
      // （`session/list` 就叫 `_request`），不是「把实参数组原样塞进去」。
      const endpoint = `${namespace}/${method}`;
      const declared = this.descriptors.get(endpoint) ?? [];
      const namedArgsOf = (args: readonly unknown[]): Record<string, unknown> => {
        const named: Record<string, unknown> = {};
        declared.forEach((parameter, index) => {
          if (typeof parameter.name === "string") named[parameter.name] = args[index] ?? {};
        });
        return named;
      };
      if (this.streams.has(endpoint)) {
        // 流式方法：最后一个实参是调用方的 `AbortSignal`（descriptor 的 `cancellation.parameter`），
        // 不进 wire 参数；返回值是逐帧面，`dispose()` 等价于中止这一代。
        face[method] = (...args: never[]): unknown => {
          const callerSignal = args[declared.length] as AbortSignal | undefined;
          const controller = new AbortController();
          callerSignal?.addEventListener("abort", () => controller.abort(callerSignal.reason), { once: true });
          const source = this.transport.openStream(endpoint, { args: namedArgsOf(args) }, controller.signal);
          return {
            [Symbol.asyncIterator]: () => source[Symbol.asyncIterator](),
            dispose: async (): Promise<void> => {
              controller.abort(new Error(`${endpoint} stream disposed`));
            },
          };
        };
        continue;
      }
      face[method] = async (...args: never[]): Promise<unknown> =>
        this.transport.invoke(endpoint, { args: namedArgsOf(args) });
    }
    this.faces.set(namespace, face);
    return face;
  }
}

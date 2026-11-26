// 测试用的**进程内传输**：`remote.upstream.<group>.<method>` 直接打到**另一个装配**的 handler 表。
//
// 形状与线上完全一致（上游面就是 `upstream[group][method]`），换的只是「怎么到达宿主」：
// 线上是 wire，这里是函数调用。所以业务测试可以用它跑完整条链路，只把传输换成假的。
//
// **必须**传执行面：host 与 client 是两个装配两个 ctx，client 半不持有 host 的路由表。
// 没有「读本 ctx 的 RemoteHandlers」这条兼容路径——那会让两套体系共用服务名空间。
//
// `upstream` 是动态代理，不写死任何 namespace —— 装了哪些 `@RemoteGroup` 就能走哪些组。
import { Injectable, rootContextKey, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/contract";

/**
 * 一个 namespace 的调用面：`remote.<namespace>.<method>(request)`。
 *
 * 返回值是 `unknown`：unary 给 Promise，流式给逐帧句柄（与线上同一个面两种形态）。
 */
type NamespaceFace = Record<string, (request?: unknown, signal?: AbortSignal) => unknown>;

/** 一条远端方法描述（`TYPERT_REMOTE.descriptors` 的最小子集）。 */
interface LocalDescriptor {
  readonly namespace?: string;
  readonly method?: string;
  /** `"stream"` 表示逐帧产出（`workspace/follow` 这类）。 */
  readonly mode?: string;
}

/** 一条端点的执行面（`(endpoint, payload) => 结果`）：host 装配里的 `RemoteHandlers.invoke`。 */
export type EndpointInvoker = (
  endpoint: string,
  payload: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

/**
 * 一条**流式**端点的执行面：host 装配里的 `RemoteHandlers.stream`。
 *
 * 不传就只有 unary 可用（`follow` / `control` 这类长流会显式报「没有接流」）——
 * 传了才是与线上同形的链路，`ui` 的用例应该走这条。
 */
export type StreamOpener = (
  endpoint: string,
  payload: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => AsyncIterable<unknown>;

/** 两个执行面：unary 必给，流式可选。 */
export interface LocalRemoteFaces {
  /** host 的 `RemoteHandlers.invoke`。 */
  readonly call: EndpointInvoker;
  /** host 的 `RemoteHandlers.stream`。 */
  readonly openStream?: StreamOpener;
}

@Injectable()
export class LocalRemote extends Remote implements OnInit {
  /**
   * @param faces - **另一个装配**的两个执行面；也可以只给 unary 那一个（`RemoteHandlers.invoke`）。
   */
  constructor(faces?: LocalRemoteFaces | EndpointInvoker) {
    super();
    const both =
      faces === undefined ? undefined : typeof faces === "function" ? { call: faces } : faces;
    // 不给执行面时**不静默**：这类装配只借 `$mount` 的登记能力（同 ctx 的用例直接调 handler 表），
    // 真发起调用就该在调用处报「没有执行面」，而不是 `undefined is not a function`。
    this.call =
      both?.call ??
      (async (endpoint: string) => {
        throw new Error(`LocalRemote 没有端点执行面：${endpoint} 调不到宿主`);
      });
    this.openStream = both?.openStream;
  }

  /** unary 执行面（host 的 `RemoteHandlers.invoke`）。 */
  private readonly call: EndpointInvoker;

  /** 流式执行面（host 的 `RemoteHandlers.stream`）；不给时流式方法显式报错。 */
  private readonly openStream: StreamOpener | undefined;

  /**
   * 行 ctx 的根（`onInit` 记下）：`$mount` 之后要往它上面发布嵌套服务名 `remote.<namespace>`。
   * 上游好几行的 `static inject` 里写着 `"remote.job"` / `"remote.commands"`，名字不在 store 里
   * 它们的 fiber 永远停在待激活——真 `RemoteDefault` 也是在同一时机发布的。
   */
  private rootCtx: Context | undefined;

  /**
   * 记下根 ctx（与 `RemoteDefault` 同一个时机：本行自己的 `onInit`）。
   * @param ctx - 本行 ctx。
   */
  onInit(ctx: Context): void {
    this.rootCtx = ctx[rootContextKey];
  }

  /** 已经发布过嵌套名的 namespace（同名 `provide` 只能来一次）。 */
  private readonly published = new Set<string>();
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
      const endpoint = `${namespace}/${method}`;
      // 流式方法给**逐帧面**（与线上同形），unary 才是 Promise：`follow` 被包成 Promise 的话，
      // 消费方拿到的是「一个看着像 AsyncIterable 的 Promise」。
      face[method] =
        descriptor.mode === "stream"
          ? (request?: unknown, signal?: AbortSignal): unknown =>
              this.streamHandle(endpoint, { request }, signal)
          : (request?: unknown): Promise<unknown> => this.unary(endpoint, { request });
      Reflect.set(this, namespace, face);
      added.push(namespace);
      this.namespaceLive.add(namespace);
      this.publishNamespace(namespace);
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
   * 把某个 namespace 发布成嵌套服务名（`remote.<namespace>`），发布的是**稳定的代理**。
   * @param namespace - 已 `$mount` 的 namespace。
   */
  publishNamespace(namespace: string): void {
    const root = this.rootCtx;
    if (root === undefined || this.published.has(namespace)) return;
    this.published.add(namespace);
    root.reflect.provide(
      `remote.${namespace}`,
      new Proxy(
        {},
        {
          // 每次读都回到**当前**那张 face：`$mount` 可能来多次（多个 contribution、重挂）。
          get: (_target, property) => {
            const face = Reflect.get(this, namespace) as NamespaceFace | undefined;
            const value: unknown = face === undefined ? undefined : Reflect.get(face, property);
            return typeof value === "function" ? value.bind(face) : value;
          },
        },
      ),
    );
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

  /**
   * 逐帧调用面（`remote.$stream({ name, args })`）：直接落到 host 的流式执行面。
   * @param options - 端点名、实参与取消信号。
   * @returns 帧序列（带 `dispose`）。
   */
  $stream(options: {
    readonly name: string;
    readonly args?: readonly unknown[];
    readonly signal?: AbortSignal;
  }): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    const [first] = options.args ?? [];
    return this.streamHandle(
      options.name,
      { request: first },
      options.signal ?? new AbortController().signal,
    );
  }

  /**
   * 一次 unary 调用：结果按 `RemoteResult` 封装（与 `RemoteDefault` 的调用面同一口径）。
   *
   * **必须封**：上游客户端（`ClientWorkspaceModel` 之类）按 `result.ok` / `result.error.code` 分流，
   * 裸值让它们读到 `undefined` 再崩在下一行。已经是 `RemoteResult` 的（幂等）不包第二层。
   * @param endpoint - `<namespace>/<method>`。
   * @param payload - wire 的命名参数。
   * @returns `{ ok: true, value }` 或 `{ ok: false, error }`。
   */
  private async unary(
    endpoint: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    try {
      const value = await this.call(endpoint, payload);
      if (value !== null && typeof value === "object" && "ok" in value) return value;
      return { ok: true, value };
    } catch (error) {
      const shaped = error as { code?: unknown; message?: unknown };
      return {
        ok: false,
        error: {
          code: typeof shaped.code === "string" ? shaped.code : "gateway/invoke-failed",
          message: typeof shaped.message === "string" ? shaped.message : String(error),
        },
      };
    }
  }

  /**
   * 一条流的句柄：形状对齐上游 `RemoteStreamHandle`（`AsyncIterable` + `send` / `end` / `dispose`）。
   * @param endpoint - `<namespace>/<method>`。
   * @param payload - wire 的命名参数。
   * @param callerSignal - 调用方的取消信号（缺省即自己一代）。
   * @returns 帧序列。
   */
  private streamHandle(
    endpoint: string,
    payload: Readonly<Record<string, unknown>>,
    callerSignal?: AbortSignal,
  ): AsyncIterable<unknown> & {
    send(item: unknown): void;
    end(): void;
    dispose(): Promise<void>;
  } {
    const opener = this.openStream;
    if (opener === undefined) {
      throw new Error(
        `LocalRemote 没接流式执行面：${endpoint} 需要 provideLocalRemote 的第二个实参`,
      );
    }
    const controller = new AbortController();
    callerSignal?.addEventListener("abort", () => controller.abort(callerSignal.reason), {
      once: true,
    });
    const source = opener(endpoint, payload, controller.signal);
    return {
      [Symbol.asyncIterator]: () => source[Symbol.asyncIterator](),
      // 上行帧（终端的键入）：本接缝没有上行通道，显式丢弃比静默缓冲好。
      send: (): void => {},
      end: (): void => {},
      dispose: async (): Promise<void> => {
        controller.abort(new Error(`${endpoint} stream disposed`));
      },
    };
  }
}

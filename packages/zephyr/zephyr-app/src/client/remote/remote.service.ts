// remote（客户端）：**自实现**，只对齐上游的行为（wire 协议），不包装它的实现。
//
// 上游 `ClientRemoteService` 把每个 namespace 注册成独立 cordis 服务、再靠实例上的动态 getter
// 伪装成 `remote.<ns>`；我们这层包装会丢掉那层 getter，导致 `remote.session` 永远 undefined。
// 这里按契约直接实现：`$mount` 只登记 descriptor，`remote.<ns>` 由 Proxy 按 descriptor 组请求，
// 请求走 `connection.rpc.open('/api', '<ns>/<method>', args)`（与上游同一条 wire 通道）。
import { inject, Injectable, rootContextKey, type Context } from "@morlay/zephyr";
import { ClientConnection } from "@morlay/zephyr-app/contract";
import { Remote } from "@morlay/zephyr-app/contract";
import { failureOf } from "@morlay/zephyr-app/contract";
import { RemoteStream, type RemoteStreamOptions } from "@deepseek-ai/dsh-api-gateway/client";
import { Typert } from "@morlay/zephyr-app/contract";
import {
  muxTransport,
  type RemoteInvocation,
  type RemoteOutcome,
  type RemoteTransport,
} from "./remote-transport.ts";

/**
 * 一份绑定到底是什么（`$mount` 失败时报给人看）。
 * @param contribution - 调用方传进来的绑定。
 * @returns 可读描述。
 */
function describeContribution(contribution: unknown): string {
  if (contribution === undefined) return "undefined";
  if (contribution === null) return "null";
  if (typeof contribution !== "object") return typeof contribution;
  const keys = Object.keys(contribution as object);
  return keys.length === 0 ? "{}" : `{ ${keys.join(", ")} }`;
}

/** 一个 wire 参数：调用方形参名（`name`）与 wire 字段名（`wire`）。 */
interface RemoteParameter {
  readonly name?: string;
  readonly wire?: string;
}

/** 一条 remote 方法描述（`TYPERT_REMOTE.descriptors` 的子集）。 */
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
  private readonly connection = inject(ClientConnection);

  /**
   * agent 作用域解析：转发的请求只带 `agentId`，要换成客户端的 agent ctx 才能把
   * `this` 交给 listener（上游 `ctx.sessions.scopeOf(this)` 靠它认会话）。
   */
  private readonly typert = inject.optional(Typert);

  /**
   * 行 ctx（`onInit` 记下）。
   *
   * 答复请求时要用它**按名字晚绑定**读会话域的「id → 作用域」适配面（见写作规范里"禁止按名字读
   * 服务"的例外条款）：写成 `inject` 会成环——会话域的适配行依赖 `SessionController`，而
   * `SessionController` 又依赖本行；环上的 fiber 永远停在 pending，症状是客户端连 `session/list`
   * 都不发。晚绑定读不进依赖图。
   */
  private rowCtx: Context | undefined;

  /** `namespace/method` → 该方法的参数声明（wire 上要**命名参数**，不能发数组）。 */
  private readonly descriptors = new Map<string, readonly RemoteParameter[]>();

  /** `namespace/method` → 是不是流式方法。 */
  private readonly streams = new Set<string>();

  /** `namespace` → 方法名集合（`$mount` 登记，Proxy 据此判定「这个名字是不是 remote 方法」）。 */
  private readonly namespaces = new Map<string, Set<string>>();

  private readonly faces = new Map<string, NamespaceFace>();

  /** 传输实现：默认 mux（生产）；测试可以直接替换。 */
  // **惰性**取 `connection`：字段初始化时它还是占位符，`resolvePending` 之后才换成真实例。
  // **惰性**取：字段初始化时 `connection` 还是占位符。
  private transport: RemoteTransport = muxTransport(() => this.connection);

  /**
   * cordis 的**嵌套服务名**要显式发布：上游好几行的 `static inject` 里写着 `'remote.session'`
   * / `'remote.commands'`（`ModelDirectoryResolver`、`CommandUiRuntime` 都是），名字不在 store 里
   * 它们的 fiber 永远停在待激活，于是对应的目录不注册、整个装配也跟着卡住。
   *
   * 注册到**根**：读它们的那些行在别的分支上，沿 fiber 链只能看到 root。
   */
  onInit(ctx: Context): void {
    this.rootCtx = ctx[rootContextKey];
    this.rowCtx = ctx;
    this.publishNamespace("session");
  }

  /** 根 ctx（`onInit` 时记下；`$mount` 之后要往它上面发布嵌套名）。 */
  private rootCtx: Context | undefined;

  /**
   * 把某个 namespace 的调用面发布成嵌套服务名（`remote.<namespace>`）。
   *
   * 发布的是**稳定的代理**而不是当时那张 face：`$mount` 可以来多次（多个 contribution、重连后重挂），
   * 每次都 `provide` 同名会直接抛 `service "remote.<ns>" has been registered`。
   * @param namespace - 已 `$mount` 的 namespace。
   */
  private publishNamespace(namespace: string): void {
    const root = this.rootCtx;
    if (root === undefined || this.published.has(namespace)) return;
    const face = new Proxy(
      {},
      {
        // 每次读属性都回到**当前**那张 face：`$mount` 可能来多次，代理得跟着走。
        get: (_target, property) => {
          const current = this.faceOf(namespace);
          if (current === undefined) return undefined;
          const value = (current as Record<PropertyKey, unknown>)[property];
          return typeof value === "function"
            ? (value as (...args: never[]) => unknown).bind(current)
            : value;
        },
        has: (_target, property) => {
          const current = this.faceOf(namespace);
          return current !== undefined && property in current;
        },
      },
    );
    this.published.add(namespace);
    root.provide(`remote.${namespace}`, face);
  }

  /** 已经发布过嵌套服务名的 namespace（`provide` 重复会抛）。 */
  private readonly published = new Set<string>();

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
    const descriptors =
      (contribution as { descriptors?: readonly RemoteDescriptor[] } | undefined)?.descriptors ??
      [];
    // **不静默**：空 descriptors 等于"什么都没挂"，之后消费方读 `remote.<ns>` 只会拿到 undefined，
    // 报错点会漂到很远的地方（实测：`ui-permission: Cannot read properties of undefined (reading 'catalog')`）。
    if (descriptors.length === 0) {
      throw new Error(
        `[remote] $mount 收到没有 descriptors 的绑定（${describeContribution(contribution)}）：` +
          "通常是 import 互操作把它解成了 undefined/default，检查那条 `TYPERT_REMOTE` 的导出形态",
      );
    }
    const mounted: { namespace: string; method: string }[] = [];
    for (const descriptor of descriptors) {
      if (typeof descriptor.namespace !== "string" || typeof descriptor.method !== "string")
        continue;
      const endpointKey = `${descriptor.namespace}/${descriptor.method}`;
      const declared = (descriptor as { parameters?: readonly RemoteParameter[] }).parameters ?? [];
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
    // 嵌套服务名跟着一起发布：`static inject: ['remote.<ns>']` 的行要按名字找到它，
    // 否则 fiber 永远待激活（`ui-commands` 就是这样把整个装配卡住的）。
    for (const namespace of this.namespaceLive) this.publishNamespace(namespace);
    this.resolveMounted?.();
    this.resolveMounted = undefined;
    return async () => {
      for (const { namespace, method } of mounted) {
        this.namespaces.get(namespace)?.delete(method);
        this.faces.delete(namespace);
      }
    };
  }

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

  /** 频道 → 监听者（宿主推送到达时由 transport 派发；可答复频道的返回值就是答案）。 */
  private readonly listeners = new Map<string, Set<(...args: never[]) => unknown>>();

  /**
   * 订阅一个推送频道（上游行为：按 channel 分发；本实现维护本地表）。
   * @param channel - 频道名（`api-session/added` 之类）。
   * @param listener - 回调。
   * @returns 退订函数。
   */
  $on(channel: string, listener: (...args: never[]) => unknown): () => void {
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

  /** 把 transport 的推送流接到 `deliver` 与「可答复请求」的处理器（只接一次）。 */
  private wireEvents(): void {
    if (this.eventsWired) return;
    this.eventsWired = true;
    this.transport.subscribe?.((channel, ...args) => this.deliver(channel, ...(args as never[])));
    this.transport.answer?.((invocation) => this.answerInvocation(invocation));
  }

  /**
   * 回答一条**要答复**的转发请求（审批、用户提问）：按注册顺序走 listener，第一个给出答案的算数。
   *
   * 语义照上游 `waterfall`：listener 的第二参是 `next()`，调它（或什么都不返回）等于"我不认这条"，
   * 继续问下一个；返回值即答案（`outcome.kind === 'result'`）。
   *
   * `this` 必须是**该 agent 的作用域 ctx**：上游 `ui-approval` 用 `ctx.sessions.scopeOf(this)` 找会话，
   * 拿到 `undefined` 就直接 `next()`（卡片永远不弹）。所以要先把 `agentId` 解析成客户端的 agent ctx。
   * @param invocation - 宿主发来的请求。
   * @returns 本次结论。
   */
  private async answerInvocation(invocation: RemoteInvocation): Promise<RemoteOutcome> {
    const listeners = [...(this.listeners.get(invocation.event) ?? [])];
    if (listeners.length === 0 || invocation.signal.aborted) return { kind: "next" };
    // 先问会话域（它知道 id ↔ 作用域），再退回上游的 client context 适配面。
    const target = this.clientScopeOf(invocation.agentId) ?? this.scopeFromTypert(invocation);
    if (target === undefined) return { kind: "next" };
    const request = { ...invocation.request, agent: target, signal: invocation.signal };
    const NEXT = Symbol("remote.next");
    try {
      for (const listener of listeners) {
        const call = listener as (...args: unknown[]) => unknown;
        const answer = await call.call(target, request, () => NEXT);
        if (answer === NEXT || answer === undefined) continue;
        return { kind: "result", value: answer };
      }
      return { kind: "next" };
    } catch (error) {
      return {
        kind: "rejected",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * 会话域给的解析面：`agentId` → 客户端作用域。
   *
   * 读不到（没装会话域、或它还没激活）就返回 `undefined`，调用方按"没人认这条请求"处理。
   * @param agentId - 宿主给的 agent id。
   * @returns 客户端作用域，或 `undefined`。
   */
  private clientScopeOf(agentId: string): object | undefined {
    const scopes = this.rowCtx?.get("client-agent-scopes", false) as
      | { scopeOf?(id: string): object | undefined }
      | undefined;
    return scopes?.scopeOf?.(agentId);
  }

  /**
   * 上游那条解析路：`typert.contexts` 的 client 适配面（只有装了上游 client 会话域时才有）。
   *
   * 我们自己的会话域走 {@link useAgentScopes} 推过来的解析面；这里是给"上游那份装配"留的回落。
   * @param invocation - 宿主发来的请求。
   * @returns 客户端作用域，或 `undefined`（没法解析就按"没人认这条请求"处理）。
   */
  private scopeFromTypert(invocation: RemoteInvocation): object | undefined {
    try {
      const adapter = this.typert?.contexts.getClient("agent") as
        | { resolve?: (id: string) => unknown }
        | undefined;
      const resolved = adapter?.resolve?.(invocation.agentId);
      if (resolved === undefined || resolved === null) return undefined;
      const value =
        typeof resolved === "object" && "value" in resolved
          ? (resolved as { readonly value?: object }).value
          : resolved;
      return typeof value === "object" ? value : undefined;
    } catch (error) {
      console.warn(
        "[remote] 转发事件找不到 agent 作用域（%s）：%s",
        invocation.agentId,
        String(error),
      );
      return undefined;
    }
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
   * 打开一个**流式** remote 方法（上游 `remote.$stream` 的同名行为）。
   *
   * 用上游的 `RemoteStream`：它接的是 `{ name, open, ended }` 那种**自定义载具**——
   * `open` 自己决定帧从哪儿来（终端的 `TerminalView` 就是在 `open` 里 `remote.attach(...)` 拿逐帧面）。
   * 曾经这里返回空流，形状是对的、但**永远没有帧**：右栏的终端因此一直停在「正在启动…」。
   * @param options - 流参数（名字 + 可选的实参/取消信号，或自定义 `open`）。
   * @returns 逐帧面，带 `dispose`。
   */
  $stream<Item>(
    options: RemoteStreamOptions<Item>,
  ): AsyncIterable<Item> & { dispose(): Promise<void> } {
    // `RemoteStream` 的迭代项是 `RemoteStreamItem<Item>`（帧外层带 `type` / `generation`）；
    // 消费方（`TerminalView` / `SessionEventStream`）就是按那个形状读的，契约上的 `Item` 是占位。
    // 契约声明的是「裸帧」（`AsyncIterable<Item>`），上游 `RemoteStream` 产出的是**带外层的帧**
    // （`RemoteStreamItem<Item>`：`type` / `generation`）。把契约改成上游那个形状要连带改
    // 三个包的 `$stream` 替身（dsh-conversation ×3、dsh-workspace ×1），那是别的域的在制品，
    // 所以这里只留**一处**收窄断言，并把这件事记在票 07 的收尾项里（面统一后这行会消失）。
    return new RemoteStream<Item>(
      { generation: this.connection.generation },
      options,
    ) as unknown as AsyncIterable<Item> & { dispose(): Promise<void> };
  }

  /**
   * 主机事实（上游 `remote.$host` 的同名行为）：从 `connection.generation` 派生。
   *
   * 消费方（`ui-workspace` 等）用它决定 host 相关展示，所以必须与上游同形。
   *
   * `isLoopback` 影响的不只是展示——上游 `ui-settings-general` 用它决定要不要注册
   * 「打开配置文件」（`settings.action` 的 `open-document`）：它内部要建一个
   * `SettingsDocumentStore` 直接读写宿主磁盘上的配置文件，只有"浏览器与宿主同机"时才成立。
   * 本部署不提供那个入口（配置由装配面给，不经界面改文件），所以这里显式返回 `false`。
   */
  get $host(): { home: string; isLoopback: boolean } {
    // `home` 是页面自己的 origin（消费方拿它缩写文件路径）。
    const origin = typeof location === "undefined" ? "" : location.origin;
    return { home: origin, isLoopback: false };
  }

  /**
   * 上游实例：本实现**没有**上游实例（自实现），给一个空对象满足契约。
   *
   * 需要 namespace 面的消费方应该用 `remote.<namespace>.<method>(...)`。
   */
  readonly upstream: Record<string, unknown> = {};

  /**
   * 直接调一个端点：`@RemoteClient()` 生成的转发走这里。
   *
   * 与 `faceOf` 的区别是**不依赖 descriptor**：`faceOf` 只对 `$mount` 登记过的 namespace
   * 生成面，而我们自己声明的组（`commands`）没有上游 `TYPERT_REMOTE` 可挂。
   * @param endpoint - `<namespace>/<method>`。
   * @param args - wire 的命名参数。
   * @returns 宿主给的原样结果（不包 `RemoteResult`）。
   */
  async invoke(endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.transport.invoke(endpoint, { args });
  }

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
      // wire 上的键是 `wire` 而不是 `name`：上游的 descriptor 把「调用方形参名」与「wire 字段名」分开
      // （`fileReferences/list` 是 `{ name: 'agent', wire: 'agentId' }`——用 `name` 发出去，服务端的
      // schema 校验会报 `missing "agentId"; unexpected "agent"`）。
      const namedArgsOf = (args: readonly unknown[]): Record<string, unknown> => {
        const named: Record<string, unknown> = {};
        declared.forEach((parameter, index) => {
          const key = parameter.wire ?? parameter.name;
          if (typeof key === "string") named[key] = args[index] ?? {};
        });
        return named;
      };
      if (this.streams.has(endpoint)) {
        // 流式方法：最后一个实参是调用方的 `AbortSignal`（descriptor 的 `cancellation.parameter`），
        // 不进 wire 参数；返回值是逐帧面，`dispose()` 等价于中止这一代。
        face[method] = (...args: never[]): unknown => {
          const callerSignal = args[declared.length] as AbortSignal | undefined;
          const controller = new AbortController();
          callerSignal?.addEventListener("abort", () => controller.abort(callerSignal.reason), {
            once: true,
          });
          const source = this.transport.openStream(
            endpoint,
            { args: namedArgsOf(args) },
            controller.signal,
          );
          // 形状对齐上游 `RemoteStreamHandle`：`AsyncIterable` + `send` / `end` / `dispose`。
          // 双向流（`terminal/attach` 把键入送上去）用的就是 `send`；只给迭代面的话，
          // 第一次 `handle.send(...)` 就是 `handle.send is not a function`。
          return {
            [Symbol.asyncIterator]: () => source[Symbol.asyncIterator](),
            send: (item: unknown): void => {
              source.send(item);
            },
            end: (): void => {
              source.end();
            },
            dispose: async (): Promise<void> => {
              controller.abort(new Error(`${endpoint} stream disposed`));
            },
          };
        };
        continue;
      }
      // **统一包 `RemoteResult`**：上游客户端按 `result.ok` 分流（`ui-model-selection` 的
      // `catalog.load()` 直接读 `response.ok` / `response.error.code`），裸值会让它们读到 `undefined`
      // 再崩在下一行。我们的消费方用 `asRemoteResult` 包，对两种形状都成立。
      face[method] = async (...args: never[]): Promise<unknown> => {
        try {
          const value = await this.transport.invoke(endpoint, { args: namedArgsOf(args) });
          // 幂等：传输实现（测试替身、本地直连）可能已经给了 `RemoteResult`，别包第二层。
          if (value !== null && typeof value === "object" && "ok" in value) return value;
          return { ok: true, value };
        } catch (error) {
          return { ok: false, error: failureOf(error) };
        }
      };
    }
    this.faces.set(namespace, face);
    return face;
  }
}

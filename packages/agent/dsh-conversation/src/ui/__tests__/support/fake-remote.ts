// 传输层替身：实现 `Remote` 契约（`upstream` 的 namespace 面 + `$on` / `$mount` / `$stream`）。
//
// 只替**传输**：`SessionRemote` / `SessionController` 都是真实现，它们照常按
// `remote.upstream.session.<method>` 转发；这里把那次转发接到 `mockTransport` 的 handler 表上。
// 换传输层不改被测代码，也不需要读 `RemoteDefault` 的私有接缝。
import { Injectable } from "@morlay/zephyr";
import { mockTransport, Remote } from "@morlay/zephyr-app/client";
import type { SessionRemoteFace } from "../../session-remote.face.ts";

type MockHandlers = Parameters<typeof mockTransport>[0];
type MockStreams = Parameters<typeof mockTransport>[1];

/** 一次 remote 调用：`<namespace>/<method>` + 命名参数。 */
export interface RemoteCall {
  readonly endpoint: string;
  readonly args: unknown;
}

/** 替身的默认 handler 表：没有会话时目录为空（`onInit` 的首帧拉取安全落地）。 */
const EMPTY_HANDLERS: MockHandlers = {
  "session/list": () => ({ ids: [], byId: {} }),
};

/**
 * 一条**不出帧**、只按 `signal` 收尾的空流（替身里的 `session/control`）。
 *
 * 收尾跟着 signal 走：消费方 `dispose()` 会 abort，这条流才结束；不跟的话用例结束时
 * 会留一条悬着的迭代。
 * @param signal - 调用方给的取消信号。
 * @returns 空流。
 */
export function emptyStream(signal: AbortSignal): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<never>> => {
        if (!signal.aborted) {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        return { done: true, value: undefined };
      },
    }),
  };
}

@Injectable()
export class FakeRemote extends Remote {
  /**
   * 下一个实例使用的宿主应答与「挂载完成」闸门（测试在 `bootstrapApplication` 之前设置）。
   * `mounted` 省略时立即完成；给一个未兑现的 Promise 就能在首次拉取之前插入断言。
   */
  static next: { handlers: MockHandlers; streams: MockStreams; mounted?: Promise<void> } = {
    handlers: EMPTY_HANDLERS,
    streams: {},
  };

  readonly upstream: Record<string, unknown>;

  /**
   * `remote.session` 的调用面：上游 `RemoteDefault` 用 Proxy 按 namespace 生成，
   * 替身直接给出同一个对象（`SessionRemoteDefault` 的转发读的就是这个字段）。
   */
  readonly session: SessionRemoteFace & {
    list(request: unknown): Promise<unknown>;
    create(request: unknown): Promise<unknown>;
    follow(request: unknown, signal: AbortSignal): AsyncIterable<unknown>;
    /** `session/control`：投影与会话生命周期读的那条流（真 face 上必然有）。 */
    control(signal: AbortSignal): AsyncIterable<unknown>;
  };

  private transport = mockTransport(FakeRemote.next.handlers, FakeRemote.next.streams);

  private readonly mounted = FakeRemote.next.mounted ?? Promise.resolve();

  constructor() {
    super();
    // 每个方法都**经过 transport**：这样用例既能看到 wire 载荷，也能换掉宿主应答。
    const call = (endpoint: string, args: unknown): Promise<unknown> =>
      this.transport.invoke(endpoint, { args });
    this.session = {
      list: (request: unknown) => call("session/list", request),
      create: (request: unknown) => call("session/create", { request }),
      follow: (request: unknown, signal: AbortSignal) =>
        this.transport.openStream("session/follow", { args: { request } }, signal),
      // `session/control`：投影与会话生命周期都读这条流，**真 face 上必然有**。
      // 替身给一条"不出帧、按 signal 收尾"的空流：装配型 spec 的被测面不是它，但不能缺——
      // 缺了消费方会走到「组挂上了、端点却不在」那条告警上，而那是"版本不配对"的信号。
      control: (signal: AbortSignal) => emptyStream(signal),
      // 会话语义方法（与真 `remote.session` 同形）：替身里同样经过 transport。
      prompt: (request) =>
        call("session/prompt", { request }) as ReturnType<SessionRemoteFace["prompt"]>,
      cancel: (request) =>
        call("session/cancel", { request }) as ReturnType<SessionRemoteFace["cancel"]>,
      updateQueue: (request) =>
        call("session/updateQueue", { request }) as ReturnType<SessionRemoteFace["updateQueue"]>,
      rename: (request) =>
        call("session/rename", { request }) as ReturnType<SessionRemoteFace["rename"]>,
    };
    this.upstream = { session: this.session };
  }

  /** 换掉宿主应答（用例里在建会话 / 列目录之前调用）。 */
  useMock(handlers: MockHandlers, streams: MockStreams = {}): void {
    this.transport = mockTransport(handlers, streams);
  }

  /** 模拟宿主推一帧（`api-session/*` 这类频道）。 */
  emit(channel: string, ...args: unknown[]): void {
    this.transport.emit(channel, ...args);
  }

  async $mount(_contribution: unknown): Promise<() => Promise<void>> {
    return async () => {};
  }

  /** `@RemoteClient()` 生成的转发走这里：与 wire 同形（命名参数进、原样结果出）。 */
  async invoke(endpoint: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.transport.invoke(endpoint, { args });
  }

  async whenMounted(): Promise<void> {
    await this.mounted;
  }

  /**
   * 等某个 namespace 挂上。**替身没有后续 `$mount`**（面在构造时就定了）：
   * 挂上的立即兑现，没挂的永不兑现——照实建模。谎报"已挂载"会让消费方走到
   * 「组挂上了、端点却不在」那条告警上，而那是"服务端版本不配对"的信号。
   * @param namespace - 上游 namespace 名（`session`）。
   * @returns 挂上时立即兑现。
   */
  whenNamespace(namespace: string): Promise<void> {
    return Reflect.get(this, namespace) === undefined
      ? new Promise<void>(() => {})
      : Promise.resolve();
  }

  $on(channel: string, listener: (...args: never[]) => void): () => void {
    const unsubscribe = this.transport.subscribe?.((delivered, ...args) => {
      if (delivered !== channel) return;
      // 契约把监听参数声明成 `never[]`（「载荷由频道定义」），这里按运行期实参调用。
      Reflect.apply(listener, undefined, args);
    });
    return unsubscribe ?? (() => {});
  }

  $stream(options: {
    readonly name: string;
    readonly args?: readonly unknown[];
    readonly signal?: AbortSignal;
  }): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    const iterable = this.transport.openStream(
      options.name,
      { args: options.args ?? [] },
      options.signal ?? new AbortController().signal,
    );
    return Object.assign(iterable, { dispose: async (): Promise<void> => {} });
  }
}
/**
 * 最小替身：契约成员照实实现（没被用例覆盖的"明确失败"），namespace 面按构造参数挂。
 *
 * 给**不测 wire** 的装配型 spec 用——它们只需要 `$on` / `$mount` / `whenMounted` 这几条存在，
 * 以及"会话组还没挂上"（`session: undefined`）这一路。namespace 在真实现里是运行期的动态属性
 * （契约面不列），这里按名字挂同一份，读法与真实现一致（`remote.<namespace>`）。
 */
export class RemoteShell extends Remote {
  /** 本仓的替身没有上游实例（真实现里它只给框架的转发用）。 */
  readonly upstream: Record<string, unknown> = {};

  /**
   * @param namespaces - 要挂的 namespace 面；没挂的那一组读出来是 `undefined`。
   */
  constructor(namespaces: Record<string, unknown> = {}) {
    super();
    Object.assign(this, namespaces);
  }

  async $mount(): Promise<() => Promise<void>> {
    return async () => {};
  }

  async invoke(): Promise<unknown> {
    throw new Error("RemoteShell 没有实现 invoke：本 spec 不走 wire");
  }

  async whenMounted(): Promise<void> {}

  /**
   * 等某个 namespace 挂上：同 {@link FakeRemote.whenNamespace}——本替身没有后续 `$mount`，
   * 没挂的那一组（用例里的 `session: undefined`）永不兑现。
   * @param namespace - 上游 namespace 名（`session`）。
   * @returns 挂上时立即兑现。
   */
  whenNamespace(namespace: string): Promise<void> {
    return Reflect.get(this, namespace) === undefined
      ? new Promise<void>(() => {})
      : Promise.resolve();
  }

  $on(): () => void {
    return () => {};
  }

  $stream(): AsyncIterable<unknown> & { dispose(): Promise<void> } {
    throw new Error("RemoteShell 没有实现 $stream：本 spec 不走流");
  }
}

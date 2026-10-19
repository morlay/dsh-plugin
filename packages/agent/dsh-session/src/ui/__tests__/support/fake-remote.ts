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
      // 会话语义方法（与真 `remote.session` 同形）：替身里同样经过 transport。
      prompt: (request) => call("session/prompt", { request }) as ReturnType<SessionRemoteFace["prompt"]>,
      cancel: (request) => call("session/cancel", { request }) as ReturnType<SessionRemoteFace["cancel"]>,
      updateQueue: (request) =>
        call("session/updateQueue", { request }) as ReturnType<SessionRemoteFace["updateQueue"]>,
      rename: (request) => call("session/rename", { request }) as ReturnType<SessionRemoteFace["rename"]>,
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

  async whenMounted(): Promise<void> {
    await this.mounted;
  }

  async whenNamespace(_namespace: string): Promise<void> {}

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

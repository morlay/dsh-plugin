// 传输层替身（client 半）：实现 `Remote` 契约，把 `remote.workspace` 那一组接到 `mockTransport`。
//
// 只替传输：`WorkspaceController` 的默认实现照常读 `remote.workspace.follow` / 命令转发；
// 这里给出同形的 namespace 面（上游 `RemoteDefault` 用 Proxy 生成的那一层）。`workspace` 的类型是
// 上游生成物的完整面，本 spec 只喂 `follow` 与 `create`，其余方法一调就抛（不静默返回空值）。
import type { WorkspaceRemote } from "@deepseek-ai/dsh-api-workspace-controller/client";
import { Injectable } from "@morlay/zephyr";
import { mockTransport, Remote } from "@morlay/zephyr-app/client";

type MockHandlers = Parameters<typeof mockTransport>[0];
type MockStreams = Parameters<typeof mockTransport>[1];

/** 没接 mock 应答的 workspace 方法：spec 只覆盖 `follow` 与 `create`。 */
async function notWired(): Promise<never> {
  throw new Error("spec: 这个 workspace 方法没有接 mock 应答");
}

@Injectable()
export class FakeRemote extends Remote {
  /** 下一个实例使用的宿主应答（测试在 `bootstrapApplication` 之前设置）。 */
  static next: { handlers: MockHandlers; streams: MockStreams } = {
    handlers: {},
    streams: {},
  };

  readonly upstream: Record<string, unknown>;

  /** `remote.workspace` 的调用面（`WorkspaceController` 的默认实现读它）。 */
  readonly workspace: WorkspaceRemote;

  private transport = mockTransport(FakeRemote.next.handlers, FakeRemote.next.streams);

  constructor() {
    super();
    const transport = this.transport;
    this.workspace = {
      // mock 的流与 unary 都只承诺 `unknown`；形状由 spec 的 streams/handlers 保证，
      // 这里把替身兑现成生成物的返回类型（替身本来的职责，一处单层断言）。
      follow: (signal) =>
        ({
          [Symbol.asyncIterator]: () =>
            transport
              .openStream("workspace/follow", { args: {} }, signal ?? new AbortController().signal)
              [Symbol.asyncIterator](),
          send: () => {},
          end: () => {},
          dispose: () => {},
        }) as ReturnType<WorkspaceRemote["follow"]>,
      create: (request) =>
        transport.invoke("workspace/create", { args: request }) as ReturnType<WorkspaceRemote["create"]>,
      archiveSession: notWired,
      delete: notWired,
      initializeDefault: notWired,
      insertBefore: notWired,
      insertSessionBefore: notWired,
      pinSession: notWired,
      rename: notWired,
      unarchiveSession: notWired,
      unpinSession: notWired,
    };
    this.upstream = { workspace: this.workspace };
  }

  async $mount(_contribution: unknown): Promise<() => Promise<void>> {
    return async () => {};
  }

  async whenMounted(): Promise<void> {}

  async whenNamespace(_namespace: string): Promise<void> {}

  $on(_channel: string, _listener: (...args: never[]) => void): () => void {
    return () => {};
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

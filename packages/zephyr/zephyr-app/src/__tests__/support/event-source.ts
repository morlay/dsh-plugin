// 上游 gateway 的**转发事件源**替身：`wireStream.open` 返回一条测试可控的流。
//
// 真实现（`typertGateway` + `api-remotes`）在宿主侧由 cordis 事件驱动；接缝测试要的是
// 「mux 把这条流的帧原样写给客户端」，所以这里只留一个可推帧的队列。
// 帧形状照上游 `$events` 流：`ready` / `emit` / `waterfall` / `cancel`。
export interface EventSourceFixture {
  /** 传给 `MuxServer` 的 gateway 面（只用到 `wireStream.open` 与失败折叠）。 */
  readonly gateway: unknown;
  /** 往事件流里推一帧。 */
  push(frame: unknown): void;
}

/**
 * 造一份可控的事件源替身。
 * @returns gateway 面与推帧入口。
 */
export function eventSource(): EventSourceFixture {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  const gateway = {
    wireStream: {
      open: async (): Promise<AsyncIterable<unknown>> => ({
        async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
          for (;;) {
            const next = queue.shift();
            if (next !== undefined) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
      }),
      failure: () => ({ code: "gateway/invoke-failed", message: "x", details: {} }),
    },
    invoke: async () => {
      throw new Error("[remote] 没有实现");
    },
  };
  return {
    gateway,
    push: (frame: unknown) => {
      queue.push(frame);
      const resume = wake;
      wake = undefined;
      resume?.();
    },
  };
}

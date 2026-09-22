/**
 * 页面侧 Gateway 流的上行通道：`open` 的 IPC 往返还没回来时先把上行项排队，
 * 流 id 到位后按序发给主进程（主进程把它们写成宿主请求体的后续行）。
 *
 * 上行项是逻辑流的输入值（序列化成请求体的行由主进程做）：格式的 home 在
 * `@morlay/dsh-desktop-host/wire`。
 */
export interface StreamUplink {
  /** 绑定宿主侧的流 id；把排队中的项发出去。同一通道只绑一次。 */
  bind(streamId: number): void;
  /** 一道上行项（Gateway 逻辑流的输入值）。 */
  push(item: unknown): void;
  /** 上行结束：主进程据此结束宿主请求体（宿主侧的 uplink 迭代随之结束）。 */
  close(): void;
}

/** 造一条上行通道；`send` / `end` 是主进程方向的投递函数。 */
export function createStreamUplink(
  send: (streamId: number, item: unknown) => void,
  end: (streamId: number) => void,
): StreamUplink {
  let streamId: number | undefined;
  let closed = false;
  const queued: unknown[] = [];
  return {
    bind(id) {
      if (streamId !== undefined) throw new Error("dsh desktop: stream uplink is already bound");
      streamId = id;
      for (const item of queued) send(id, item);
      queued.length = 0;
      if (closed) end(id);
    },
    push(item) {
      if (closed) return;
      if (streamId === undefined) queued.push(item);
      else send(streamId, item);
    },
    close() {
      if (closed) return;
      closed = true;
      if (streamId !== undefined) end(streamId);
    },
  };
}

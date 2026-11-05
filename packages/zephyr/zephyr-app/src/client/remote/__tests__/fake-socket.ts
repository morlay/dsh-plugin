/**
 * 可控的假 WebSocket：测试侧决定什么时候 open、什么时候来一帧。
 *
 * 它不是「探针」——是 `muxTransport` 的**接缝替身**，让「建连 / 排队 / 帧解析 / 分流」
 * 在秒级的 `vitest` 里被断言，而不必靠 e2e。
 */
export class FakeSocket {
  readyState = 0;

  readonly sent: string[] = [];

  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  /** 模拟建连成功。 */
  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) listener({});
  }

  /** 模拟载体断开（宿主重启 / 网络中断）。 */
  close(): void {
    this.readyState = 3;
    for (const listener of this.listeners.get("close") ?? []) listener({});
  }

  /** 模拟宿主发来一帧。 */
  receive(frame: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: JSON.stringify(frame) });
  }

  /** 已发出的帧（解析后的形态）。 */
  framesSent(): unknown[] {
    return this.sent.map((text) => JSON.parse(text) as unknown);
  }
}

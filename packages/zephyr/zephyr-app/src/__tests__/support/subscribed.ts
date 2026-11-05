import type { RemoteHandlersDefault } from "../../api-gateway/remote-handlers.service.ts";

/**
 * 等服务端订阅到某条频道：`$events` 的 open 帧处理完就是"可以 publish 了"。
 *
 * `MuxServer` 收到 open 帧后按频道同步订阅，所以订阅到目标频道 = publish 不会漏帧。
 * @param handlers - 服务端的路由表。
 * @param channel - 目标频道。
 * @returns 订阅就位的信号。
 */
export function subscribedOnce(handlers: RemoteHandlersDefault, channel: string): Promise<void> {
  let ready: (() => void) | undefined;
  const subscribed = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const original = handlers.subscribe.bind(handlers);
  handlers.subscribe = (name, listener) => {
    const off = original(name, listener);
    if (name === channel) ready?.();
    return off;
  };
  return subscribed;
}

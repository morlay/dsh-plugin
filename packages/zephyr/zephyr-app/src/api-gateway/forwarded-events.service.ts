// 宿主 cordis 事件 → Remote 频道的**唯一一座桥**。
//
// 上游把「哪些 cordis 事件要转给浏览器」写在一张表里（`API_REMOTE_FORWARDED_EVENTS`），
// 并在自己的转发循环里逐条 `ctx.on(...)`。我们自研的 `MuxServer` 只做了反方向（订阅表 → 往 socket 写帧），
// 没有这一侧——于是 `api-session/status` / `added` / `removed` / `activity` 从来没到过浏览器：
// `session.running` 永远 false（界面上没有「深度求索中，用时 X」），侧栏也不跟着增删更新。
import { API_REMOTE_FORWARDED_EVENTS } from "@deepseek-ai/dsh-api-remotes";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "./remote-handlers.contract.ts";

/** 把表里的每个事件接到 `RemoteHandlers.publish`（频道名就是事件名）。 */
@Injectable()
export class ForwardedEventsBridge implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  onInit(ctx: Context): void {
    for (const entry of API_REMOTE_FORWARDED_EVENTS) {
      const off = ctx.on(entry.event, (...args: never[]) => {
        this.handlers.publish(entry.event, ...args);
      });
      ctx.effect(() => off);
    }
  }
}

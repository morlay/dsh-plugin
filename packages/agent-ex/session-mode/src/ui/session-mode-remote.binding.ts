// 把 `sessionMode` 组的契约声明挂到客户端 `remote` 上。
//
// 我们的组不在上游 `TYPERT_REMOTE` 里，所以这份 descriptor 由契约自己编译出来
// （`remoteDescriptorsOf`，与宿主侧 `registerRemoteGroup` 成对）。
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { SessionModeEndpoint } from "../endpoint/session-mode-endpoint.ts";

@Injectable()
export class SessionModeRemoteBinding implements OnInit {
  private readonly remote = inject(Remote);

  async onInit(ctx: Context): Promise<void> {
    const dispose = await this.remote.$mount(remoteDescriptorsOf(SessionModeEndpoint));
    ctx.effect(() => dispose);
  }
}

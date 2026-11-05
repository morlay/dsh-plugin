// 把 `commands` 组的契约声明挂到客户端 `remote` 上：`remote.commands.list` / `.execute`。
//
// 上游消费方（`ui-commands` 的目录）读的是 `ctx.remote.commands`——那是**按 namespace 的**面，
// 只有 `$mount` 过 descriptor 才有。我们的组不在上游 `TYPERT_REMOTE` 里，所以这份 descriptor
// 由契约自己编译出来（`remoteDescriptorsOf`，与宿主侧 `registerRemoteGroup` 成对）。
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { remoteDescriptorsOf } from "@morlay/zephyr-app/remote";
import { CommandEndpoint } from "../endpoint/command-endpoint.ts";

/** `commands` 组的客户端挂载：装配时装一次，卸载随行 fiber。 */
@Injectable()
export class CommandRemoteBinding implements OnInit {
  private readonly remote = inject(Remote);

  async onInit(ctx: Context): Promise<void> {
    const dispose = await this.remote.$mount(remoteDescriptorsOf(CommandEndpoint));
    ctx.effect(() => dispose);
  }
}

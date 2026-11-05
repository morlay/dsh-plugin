// `CommandEndpoint` 的**客户端形态**：只消费、不实现。
//
// `@RemoteClient()` 负责两件事：注册成 provider、给契约里声明的每个方法生成转发
// （读 `remote.upstream.commands.<method>`）。组名从契约继承，这里不写；方法体也不用写。
//
// `remote` 字段在这里显式声明：契约类**不**继承 `RemoteClientBase`（那个基类带 `inject(Remote)`，
// 而契约被宿主侧共用，宿主没有 `Remote` 这个服务）。
import { CommandEndpoint } from "@morlay/dsh-command/endpoint";
import { RemoteClient } from "@morlay/zephyr-app/remote";
import { inject } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";

/** `commands` 组的客户端契约实例。 */
@RemoteClient()
export class CommandEndpointClient extends CommandEndpoint {
  /** 转发目标：上游实例面（`remote.upstream.<group>`）。 */
  protected readonly remote = inject(Remote);
}

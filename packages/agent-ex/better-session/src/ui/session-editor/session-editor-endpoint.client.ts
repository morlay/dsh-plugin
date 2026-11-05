// `sessionEditor` 组的**客户端形态**：只消费、不实现。
//
// `@RemoteClient()` 给契约里声明的每个方法生成转发（走 `remote.invoke`，不依赖 descriptor）；
// 组名从契约继承，这里不写。
import { SessionEditorEndpoint } from "@morlay/better-session/endpoint";
import { inject } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient } from "@morlay/zephyr-app/remote";

@RemoteClient()
export class SessionEditorEndpointClient extends SessionEditorEndpoint {
  protected readonly remote = inject(Remote);
}

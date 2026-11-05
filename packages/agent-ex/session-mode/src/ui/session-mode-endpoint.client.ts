// `sessionMode` 组的**客户端形态**：只消费、不实现。
//
// `@RemoteClient()` 注册成 provider 并给契约里声明的每个方法生成转发（走 `remote.invoke`）。
// 组名从契约继承，这里不写；方法体也不用写。
import { inject } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient } from "@morlay/zephyr-app/remote";
import { SessionModeEndpoint } from "../endpoint/session-mode-endpoint.ts";

/** `sessionMode` 组的客户端契约实例。 */
@RemoteClient()
export class SessionModeEndpointClient extends SessionModeEndpoint {
  /** 转发目标：`remote.invoke("<group>/<method>", { request })`。 */
  protected readonly remote = inject(Remote);
}

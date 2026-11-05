// `sessionAdmin` 组的客户端形态：只消费、不实现。
import { SessionAdminEndpoint } from "@morlay/better-session/endpoint";
import { inject } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";
import { RemoteClient } from "@morlay/zephyr-app/remote";

@RemoteClient()
export class SessionAdminEndpointClient extends SessionAdminEndpoint {
  protected readonly remote = inject(Remote);
}

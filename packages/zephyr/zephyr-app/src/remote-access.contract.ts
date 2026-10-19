// 远端访问决策契约（上游 `RemoteAccessService` 的服务面）。
import { Injectable } from "@morlay/zephyr";
import type RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";

@Injectable()
export abstract class RemoteAccess {
  abstract readonly decide: RemoteAccessService["decide"];
}

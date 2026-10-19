// `CommandCatalog` 的**浏览器实现**：按契约走 `remote.commands.list`。
//
// 它只依赖 `CommandEndpointClient`（契约的客户端形态），不碰宿主实现——换传输也不影响这一层。
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { CommandCatalog, type CommandEntry } from "@morlay/dsh-command/endpoint";
import { inject, Injectable } from "@morlay/zephyr";
import { CommandEndpointClient } from "./command-endpoint-client.ts";

/** 走 remote 的命令目录。 */
@Injectable()
export class RemoteCommandCatalog extends CommandCatalog {
  private readonly endpoint = inject(CommandEndpointClient);

  async list(sessionId: SessionId): Promise<readonly CommandEntry[]> {
    const value = await this.endpoint.list({ sessionId });
    return value.commands;
  }
}

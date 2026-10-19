// `CommandRunner` 的**浏览器实现**：按契约走 `remote.commands.execute`。
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { CommandRunner } from "@morlay/dsh-command/endpoint";
import { inject, Injectable } from "@morlay/zephyr";
import { CommandEndpointClient } from "./command-endpoint-client.ts";

/** 走 remote 的命令执行器。 */
@Injectable()
export class RemoteCommandRunner extends CommandRunner {
  private readonly endpoint = inject(CommandEndpointClient);

  async run(sessionId: SessionId, name: string, input?: string): Promise<void> {
    await this.endpoint.execute({ sessionId, name, ...(input === undefined ? {} : { input }) });
  }
}

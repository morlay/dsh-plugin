// `CommandRunner` 的**浏览器实现**：按契约走 `remote.commands.execute`。
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { commandLineOf, type CommandExecuteValue } from "@morlay/dsh-command/endpoint";
import { CommandRunner } from "@morlay/dsh-command/contract";
import { inject, Injectable } from "@morlay/zephyr";
import { CommandEndpointClient } from "./command-endpoint.client.ts";

/** 走 remote 的命令执行器。 */
@Injectable()
export class RemoteCommandRunner extends CommandRunner {
  private readonly endpoint = inject(CommandEndpointClient);

  async run(sessionId: SessionId, name: string, input?: string): Promise<CommandExecuteValue> {
    // wire 上是**整行**（与上游客户端一致：`execute(sessionId, line, attachments)`）；`name` / `input`
    // 到这一层才拼回去，规则住在 `commandLineOf`。附件本装配不消费，给空数组。
    return this.endpoint.execute(sessionId, commandLineOf(name, input), []);
  }
}

// `commands` 组的**宿主侧实现**：把注册表接到契约定义的方法上，并注册到 wire。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`），这里只写业务转发。
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentDirectory } from "@morlay/dsh-agent";
import { CommandEndpoint, type CommandExecuteRequest, type CommandExecuteValue, type CommandListRequest, type CommandListValue } from "@morlay/dsh-command/endpoint";
import { inject, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
// 相对引用：契约面只放 `register`，按 agent 读/执行在实现面上（本包内部）。
import { CommandRegistryDefault } from "../command-registry.service.ts";
import { commandEntryOf } from "./command-entry-of.ts";
import { runCommand } from "./command-execution.ts";

/** `commands` 组的宿主实现。 */
@RemoteGroup()
export class CommandEndpointDefault extends CommandEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly registry = inject(CommandRegistryDefault);

  private readonly agents = inject(AgentDirectory);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  override async list(request: CommandListRequest): Promise<CommandListValue> {
    const agent = this.agents.get(SessionId(request.sessionId));
    if (agent === undefined) return { commands: [] };
    return { commands: this.registry.list(agent).map(commandEntryOf) };
  }

  override async execute(request: CommandExecuteRequest): Promise<CommandExecuteValue> {
    const agent = this.agents.get(SessionId(request.sessionId));
    if (agent === undefined) throw new Error("commands/execute: 缺少会话或命令名");
    return await runCommand({
      registry: this.registry,
      agent,
      name: request.name,
      input: request.input,
      where: "commands/execute",
    });
  }
}

// `commands` 组的**宿主侧实现**：把注册表接到契约定义的方法上，并注册到 wire。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`），这里只写业务转发。
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentDirectory } from "@morlay/dsh-agent";
import type { CommandSubmitAttachment } from "@deepseek-ai/dsh-commands/types";
import {
  CommandEndpoint,
  CommandId,
  type CommandExecuteValue,
  type CommandListValue,
  splitCommandLine,
} from "@morlay/dsh-command/endpoint";
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

  override async list(sessionId: SessionId): Promise<CommandListValue> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return [];
    return this.registry.list(agent).map(commandEntryOf);
  }

  override async execute(
    sessionId: SessionId,
    line: string,
    // 附件按协议收下但本装配不消费（见债：命令附件未接线）；类型与契约一致，不宽化。
    _submittedAttachments: readonly CommandSubmitAttachment[],
  ): Promise<CommandExecuteValue> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) throw new Error(`commands/execute: 会话 "${sessionId}" 没有 agent`);
    // wire 上是整行（上游协议）：拆名在宿主侧做，规则只有 `splitCommandLine` 一份。
    const { name } = splitCommandLine(line);
    const execution = await runCommand({
      registry: this.registry,
      agent,
      line,
      where: "commands/execute",
    });
    // `runCommand` 的 `undefined` 是「注册表里没这条命令」——按 wire 契约回一个结构化失败，
    // 而不是让调用方收到 `undefined` 再去猜。
    if (execution === undefined) {
      return { commandId: CommandId(""), result: { kind: "error", text: `没有命令 "${name}"` } };
    }
    return execution;
  }
}

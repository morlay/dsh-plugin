// 端口的**同进程实现**（执行器）：直接接命令注册表的实现类，中间不经过 wire。
//
// 单机模式与集成测试用；生产浏览器那一侧用 `RemoteCommandRunner`（走 `remote.commands.execute`）。
// 注入实现类而不是契约：执行入口（含 `command/run` 生命周期事件）在注册表的实现面，不在写契约上。
import { inject, Injectable } from "@morlay/zephyr";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentDirectory } from "@morlay/dsh-agent";
import { CommandRunner } from "@morlay/dsh-command/endpoint";
// 相对引用：本包根出口会带进 `./server` 的装配模块，走包名会把依赖绕成环。
import { CommandRegistryDefault } from "../command-registry.service.ts";
import { runCommand } from "./command-execution.ts";

/** 直连注册表的执行器实现：交给注册表自己的执行入口（它负责解析与生命周期事件）。 */
@Injectable()
export class RegistryRunner extends CommandRunner {
  private readonly registry = inject(CommandRegistryDefault);

  private readonly agents = inject(AgentDirectory);

  async run(sessionId: SessionId, name: string, input?: string): Promise<void> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) throw new Error(`commands: 会话 "${sessionId}" 没有 agent`);
    await runCommand({ registry: this.registry, agent, name, input, where: "commands" });
  }
}

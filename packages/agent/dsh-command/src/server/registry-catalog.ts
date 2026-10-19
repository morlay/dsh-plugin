// 端口的**同进程实现**：直接接命令注册表的实现类（上游 `CommandRuntime` 的适配实例），中间不经过 wire。
//
// 这是包 API 的一部分（不是测试辅助）：单机模式与集成测试都用它——两端在同一个进程里时，
// `CommandCatalog` 就是注册表的一层薄封装，没有理由再绕一次 wire。
// 生产里浏览器那一侧用 `RemoteCommandCatalog` / `RemoteCommandRunner`（走 `remote.commands.*`），
// 契约与形状完全一致，换的只是「怎么到达注册表」。
//
// 注入的是**实现类**而不是契约：契约面只放 `register`（写），按 agent 取目录是宿主内部的事。
import { inject, Injectable } from "@morlay/zephyr";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentDirectory } from "@morlay/dsh-agent";
import { CommandCatalog } from "@morlay/dsh-command/endpoint";
import type { CommandEntry } from "@morlay/dsh-command/endpoint";
// 相对引用：本包根出口会带进 `./server` 的装配模块，走包名会把依赖绕成环。
import { CommandRegistryDefault } from "../command-registry.service.ts";
import { commandEntryOf } from "./command-entry-of.ts";

/** 直连注册表的目录实现：按会话解析 agent 后取它的命令。 */
@Injectable()
export class RegistryCatalog extends CommandCatalog {
  private readonly registry = inject(CommandRegistryDefault);

  private readonly agents = inject(AgentDirectory);

  async list(sessionId: SessionId): Promise<readonly CommandEntry[]> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return [];
    return this.registry.list(agent).map(commandEntryOf);
  }
}

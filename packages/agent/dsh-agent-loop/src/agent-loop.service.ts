// agent loop：上游 `AgentLoopService` 经 `fromCordis` 接管。
import AgentLoopService from "@deepseek-ai/dsh-agent-loop";
import { AgentScopedRows } from "@morlay/dsh-agent/contract";
import { Injectable, inject, kFace, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "@morlay/dsh-agent/contract";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { ToolRegistry } from "@morlay/dsh-agent";
import { AgentLoop } from "./contract/index.ts";
import { AgentDirectory } from "@morlay/dsh-agent/contract";
import { SystemPrompt } from "@morlay/dsh-agent";

/** 上游 `AgentSetup`：`(agentCtx, agent) => commit | void`（从工厂签名派生，不另引一份上游类型）。 */
type AgentSetup = NonNullable<Parameters<AgentLoopService["createAgent"]>[1]["setup"]>;

@Injectable()
export class AgentLoopDefault extends fromCordis(AgentLoop, AgentLoopService) {
  agents = inject(AgentDirectory);

  sessions = inject(SessionStore);

  llm = inject(Llm);

  tools = inject(ToolRegistry);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjectionStore);

  /** per-agent 装配的装行能力：声明了 scope 的行（`@AgentScoped()`）由它在每个 agent 的 scope 里装。 */
  private readonly scopedRows = inject(AgentScopedRows);

  override async onInit(ctx: Context): Promise<void> {
    // `tools` / `systemPrompt` **不进 deps**：它们是真正的 cordis 服务（在 store 里），
    // 而 `deps` 会一路继承到 `agent.ctx`——上游 `file-reference-local` 用
    // `agent.ctx.inject(['systemPrompt','tools'], …)` 注册 per-agent 段落，一旦这两个名字走了
    // deps 短路，回调里拿到的是**我们的契约实例**，调用方 ctx 变成行 ctx（没有 scope 标记），
    // 段落于是掉进 global 层，第二个 agent 再注册同名段落就撞。
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessions: this.sessions,
      llm: this.llm,
      sessionProjections: this.sessionProjections,
    });
    this.installAgentRowsOnCreate();
  }

  /**
   * 把 per-agent 装配链到上游的 agent 创建上。
   *
   * 为什么包 `kFace` 上的方法：上游 `agents.setFactory` 是独占的（重复注册直接抛
   * `an agent factory is already registered`），`CreateAgentOptions.setup` 又由上游
   * `api/session-controller` 传进来——我们唯一的缝就是这个 factory 实例本身。手法与
   * `ApiSessionControllerHost.attachWorkspaceOnCreate` 相同：就地包装，不改 vendor。
   *
   * 位置：调用方的 `setup` 先跑（它组合的是这个 agent 的权威世界：模型选择、preset 行），我们的行
   * 随后装进**同一个 `agentCtx`**——两边的注册都在 `agent/created` 与第一次装配之前就位，且都落在
   * 这个 agent 的 scope 里。
   */
  private installAgentRowsOnCreate(): void {
    const upstream = this[kFace] as Pick<AgentLoopService, "createAgent" | "resume"> | undefined;
    if (upstream === undefined) return;
    const createAgent = upstream.createAgent.bind(upstream);
    const resume = upstream.resume.bind(upstream);
    upstream.createAgent = (ownerCtx, options) =>
      createAgent(ownerCtx, { ...options, setup: this.withAgentRows(options.setup) });
    upstream.resume = (ownerCtx, options) =>
      resume(ownerCtx, { ...options, setup: this.withAgentRows(options.setup) });
  }

  /**
   * 把「装行」接到调用方的 `setup` 之后。
   * @param setup - 调用方的 setup（可能没有）。
   * @returns 组合后的 setup（commit 原样交回上游）。
   */
  private withAgentRows(setup: AgentSetup | undefined): AgentSetup {
    return async (agentCtx, agent) => {
      const commit = await setup?.(agentCtx, agent);
      // 边界收窄一次：上游给的是 cordis ctx，我们的 `Context` 是它的子类型（只补了运行时本来就有的成员）。
      await this.scopedRows.install(agentCtx as Context);
      return commit;
    };
  }
}

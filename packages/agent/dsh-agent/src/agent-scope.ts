// agent 域的 per-agent 装配：scope 键、声明面（`@AgentScoped()`）与装行能力。
//
// 一个事实一个 home：**"按 agent 装配"是 agent 域的词汇**，所以 scope 键在这里定义；
// zephyr 的装配器只认 symbol、只负责按 scope 分组并在宿主给的 ctx 上装（见 `ScopedRows`）。
//
// scope 键**不导出**：它只是装配器内部的分类键，消费方不该碰——能碰就得有人记住"哪些 scope 存在"，
// 那又成了第二个 home。对外只有 `@AgentScoped()`。
import { inject, Injectable, ScopedRows, type Context } from "@morlay/zephyr";

/**
 * 按 agent 装配的分类键。
 *
 * `Symbol.for` 让同一个键跨模块同形（与仓库既有的 `morlay.*` 标记同一手法），但只活在本模块里。
 */
const ScopeAgent = Symbol.for("morlay.dsh-agent.scope.agent");

/**
 * 声明一个 Provider 由 per-agent 装配器装进**每个 agent 的 scope**。
 *
 * 与 `@Injectable()` 完全同义（后者默认 scope 是应用根）：它没有额外行为、不产生额外标记。
 * @returns 类装饰器。
 */
export function AgentScoped(): ClassDecorator {
  return Injectable({ scope: ScopeAgent });
}

/**
 * 装配器交给「agent 创建处」的装行能力。
 *
 * 每建一个 agent，创建处拿着 `agentCtx` 调 `install`：行的事件字段与注册都落在那个 ctx 上，
 * 随该 agent 的 scope 收回——不需要谁把 ctx 显式传进行里。
 */
@Injectable()
export abstract class AgentScopedRows {
  /**
   * @param agentCtx - 这个 agent 的 `agentCtx`（上游 `AgentSetup` 传进来的那个）。
   */
  abstract install(agentCtx: Context): Promise<void>;
}

/**
 * 装行能力的实现：把装配器分好的 **agent 那一组** 装到给定的 agent scope 上。
 *
 * 键不出这个文件，所以「哪一组」在这里闭合——宿主只需要认 `AgentScopedRows` 这一个令牌。
 */
@Injectable()
export class AgentScopedRowsDefault extends AgentScopedRows {
  private readonly scoped = inject(ScopedRows);

  async install(agentCtx: Context): Promise<void> {
    await this.scoped.install(ScopeAgent, agentCtx);
  }
}

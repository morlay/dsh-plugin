// per-agent 插件的贡献面：`@Injectable({ multi: true })` 的抽象类，各域给实现。
//
// 为什么是"插件清单"而不是"服务实例"：上游的 per-agent 能力是**运行时分层**——插件装在 root、
// 内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开（`file-reference-local` 的 prompt section、
// `tools` 的 per-agent 变体、`cua` / `liveshare` / `ptc` 的 effect 都是这个形状）。
// 所以「per-agent」要贡献的是**装哪些插件**，不是「每个 agent 一份实例」。
import { Injectable, type Newable, type ProviderEntry } from "@morlay/zephyr";

/**
 * 一个 per-agent 插件贡献：某个域声明「我这里哪些东西是按 agent 分层的」。
 *
 * 成员叫 `entries` 而不是 `providers`：类名已经表达了"一组"，属性再重复一次是冗余，
 * 而 `entries` 与 `ProviderEntry` 对齐（一个概念一个词）。
 */
@Injectable({ multi: true })
export abstract class AgentProviderGroup {
  /** 这个域声明为 per-agent 的条目（顺序即装配顺序）。 */
  abstract readonly entries: readonly (Newable<unknown> | ProviderEntry)[];
}

/** 标记位：这个类按 agent 的 scope 分层（与上游 `ScopedLayers` / `scopeOf` 同一套词）。 */
export const kAgentScoped = Symbol.for("morlay.dsh-agent.agent-scoped");

/** 标记的读取面（装配期检查、诊断都走它）。 */
type AgentScopedClass = { readonly [kAgentScoped]?: true };

/**
 * 声明一个 Provider 按 agent 的 scope 分层（状态/注册进 `agent.ctx` 那一层）。
 *
 * 它不改装配位置——这类插件仍然装在 root（分层需要全局实例，见文件头）。这个标记做两件事：
 * 让 `AgentProviderGroup` 的清单可以被机械核对，以及让诊断能指出「哪些是按 agent 分层的」。
 * @returns 类装饰器。
 */
export function AgentScoped(): (target: object) => void {
  return (target) => {
    (target as AgentScopedClass as Record<symbol, unknown>)[kAgentScoped] = true;
  };
}

/**
 * 读标记。
 * @param target - 类或实例的构造面。
 * @returns 是否声明为按 agent 分层。
 */
export function isAgentScoped(target: object): boolean {
  return (target as AgentScopedClass)[kAgentScoped] === true;
}

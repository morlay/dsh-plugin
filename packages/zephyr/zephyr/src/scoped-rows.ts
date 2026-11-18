// 按 scope 装配的行：`@Injectable({ scope })` 的行**不进应用根**，由装配器交给宿主在合适的 ctx 上装。
//
// 这里只认 symbol，**不知道 scope 是什么意思**——"按 agent 装配"是 agent 域的词汇，由声明方用自己
// 的 symbol 表达（见 `@morlay/dsh-agent` 的 `@AgentScoped()`）。装配器只做两件事：把带 scope 的行
// 按 scope 分组，以及在宿主给的 ctx 上把它们装一遍。
import type { Context } from "./injection.ts";
import { Injectable } from "./token.ts";

/**
 * 装配器暴露给宿主的装行能力。
 *
 * 一个事实一个 home：哪些行按 scope 装配由 **Provider 自己**说了算（`@Injectable({ scope })`），
 * 装配器只负责挑出来、分组；什么时候装、装到哪个 ctx 由宿主决定（agent 域就是「每个 agent 的
 * `agentCtx`」）。
 */
@Injectable()
export abstract class ScopedRows {
  /** 清单里出现过的 scope（去重；诊断与宿主预检用）。 */
  abstract readonly scopes: readonly symbol[];

  /**
   * 把某个 scope 的行按清单顺序装到给定 ctx 上。
   * @param scope - 要装的那一组（声明方定义的 symbol）。
   * @param ctx - 装到哪个 ctx（行的事件字段也绑它）。
   */
  abstract install(scope: symbol, ctx: Context): Promise<void>;
}

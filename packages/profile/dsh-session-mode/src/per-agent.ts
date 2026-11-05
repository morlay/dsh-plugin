// 本行替某个 agent 装的那一组注册的**收回账**。
//
// 为什么需要它：`agent.ctx.tools.register()` / `agent.ctx.systemPrompt.section()` / `agent.ctx.on()` 把 effect
// 挂在 **agent 的 scope fiber** 上（作用域必须落在那个 agent 的 layer 里，这是这些 API 的契约），所以这些注册
// **不随本行卸载**。于是「上一次装的那一份」如果只记在当前实例的 WeakMap 里，一旦本行被重挂（设置保存会让
// Loader 重新配置这一行），新实例就没有上一份可收，再装一次就抛：
// `tool "describe_tool" is already registered in this scope`、
// `prompt section "deployment:persona-prefix" is already registered in this scope`。
//
// 所以收回账挂两处，任何一处先到都收干净：
// - **本行**（`ctx`）：行卸载/重挂时把这份注册一起收；
// - **agent**（`agent.ctx`）：本行通常比 agent 活得久，agent 卸载时把上面那笔行账一起撤掉，别攒着死 agent 的闭包。
//
// `release()` 是**同步**且幂等的：`apply` 重入时「旧的收完再装新的」靠的就是这一点（`inject` fiber 的
// `dispose()` 是异步的——它要等子 fiber 卸载——所以它只能算链上的一笔，不能当唯一收回路径）。

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";

export interface PerAgentAccount {
  // 记一笔收回动作。账已经收过时就地执行，晚到的注册因此不会漏。
  add(stop: () => void): void;
  // 收回这一份：同步、幂等。
  release(): void;
}

export function perAgentAccount(ctx: Context, agent: Agent): PerAgentAccount {
  const stoppers: (() => void)[] = [];
  let released = false;
  let rowAccount: () => void = () => {};
  let agentAccount: () => void = () => {};

  const release = (): void => {
    if (released) return;
    released = true;
    for (const stop of stoppers.splice(0).reverse()) stop();
    // 两笔账本身也要撤：行账在行卸载时由本行跑，agent 账在 agent 卸载时由 agent 跑；这里先撤一次，
    // 免得每换一次模式就在 agent 的 fiber 上攒一条不再用到的清理项。
    agentAccount();
    rowAccount();
  };

  rowAccount = ctx.effect(() => () => release(), "session-mode: per-agent releases");
  agentAccount = agent.ctx.effect(() => () => release(), "session-mode: per-agent releases");

  return {
    add: (stop) => {
      if (released) stop();
      else stoppers.push(stop);
    },
    release,
  };
}

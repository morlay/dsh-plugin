// 本行替某个 agent 装的那一组注册的收回账。
//
// `agent.ctx.tools.register()` / `systemPrompt.section()` / `agent.ctx.on()` 把 effect 挂在 **agent 的 scope
// fiber** 上，所以这些注册不随本行卸载。账挂两处（行与 agent），任一处先到都收干净——本行被重挂时新实例才不会
// 撞上 `already registered`。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { Context } from "@morlay/zephyr";
import type { SessionScopeAccount } from "./contract/session-scope.contract.ts";

export function perAgentAccount(ctx: Context, agent: Agent): SessionScopeAccount {
  const stoppers: (() => void)[] = [];
  let released = false;
  let rowAccount: () => void = () => {};
  let agentAccount: () => void = () => {};

  const release = (): void => {
    if (released) return;
    released = true;
    for (const stop of stoppers.splice(0).reverse()) stop();
    agentAccount();
    rowAccount();
  };

  rowAccount = ctx.effect(() => () => release()) as unknown as () => void;
  agentAccount = (agent.ctx as unknown as Context).effect(
    () => () => release(),
  ) as unknown as () => void;

  return {
    add: (stop) => {
      if (released) stop();
      else stoppers.push(stop);
    },
    release,
  };
}

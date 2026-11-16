// 运行中 agent 目录的适配行：把宿主 agent 域（上游 `AgentRegistry`，服务名 `agents`）接到本包的
// `SessionAgentControl` 契约上。
//
// 编辑编排（`retry` / `edit` / `reroll`）要靠它两件事：动日志**之前**先停住正在跑的 turn、
// 改完日志把用户输入重新排进重放队列。缺这一行时两件都是静默 no-op：日志被截断、回复不再生成，
// 界面上就是「点重试没反应」。
//
// 目录按**契约令牌**取（`inject.optional(AgentDirectory)`）：注入在装配期回填，上游目录适配行排在
// 本行之前由同一份清单的**拓扑排序**保证——`inject.optional` 也参与排序（见 `@morlay/zephyr` 的
// `orderByDependencies` 与 `optional-inject-order.spec`）。不按服务名在调用时现读：那样每次都要
// 绕开类型去看 cordis 的服务表，且装配顺序变成"没人检查的约定"。
import { SessionId } from "@morlay/dsh-session/contract";
import { AgentDirectory, type Agent } from "@morlay/dsh-agent/contract";
import { inject, Injectable } from "@morlay/zephyr";
import {
  SessionAgentControl,
  type SessionAgentLike,
} from "../contract/session-agent-control.contract.ts";

/**
 * `SessionAgentControl` 的默认实现：把注入到的目录（上游 `Agent`）投影成本包用到的三条。
 *
 * 目录不在装配里（只跑数据面的宿主、纯端点测试）时注入得到 `undefined`：`get` 返回 `undefined`、
 * `list` 返回空表——编辑编排据此退化成「只重写日志」，与没有这一行时同形。
 */
@Injectable()
export class SessionAgentControlDefault extends SessionAgentControl {
  private readonly directory = inject.optional(AgentDirectory);

  get(id: string): SessionAgentLike | undefined {
    const agent = this.directory?.get(SessionId(id));
    return agent === undefined ? undefined : adapt(agent);
  }

  list(): readonly SessionAgentLike[] {
    return (this.directory?.list() ?? []).map(adapt);
  }
}

function adapt(agent: Agent): SessionAgentLike {
  return {
    id: agent.id,
    session: agent.session,
    followup: (message) => {
      agent.followup(message);
    },
    cancel: (cause, options) => {
      agent.cancel(cause, options);
    },
    whenIdle: () => agent.whenIdle(),
  };
}

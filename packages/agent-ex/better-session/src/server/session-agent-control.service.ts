// 运行中 agent 目录的适配行：把宿主 agent 域（上游 `AgentRegistry`，服务名 `agents`）接到本包的
// `SessionAgentControl` 契约上。
//
// 编辑编排（`retry` / `edit` / `reroll`）要靠它两件事：动日志**之前**先停住正在跑的 turn、
// 改完日志把用户输入重新排进重放队列。缺这一行时两件都是静默 no-op：日志被截断、回复不再生成，
// 界面上就是「点重试没反应」。
//
// 为什么按**服务名在调用时**读，而不是 `inject(AgentDirectory)`：
// - 装配顺序里 agent 域排在会话域**之后**（`sessionCoreProviders` 在 `agentProviders` 之前），装配期
//   回填拿到的会是 `undefined` 并且永不更新；
// - 本包不该为一次结构读取多一个 `@morlay/dsh-agent` 依赖：用到的只有 `get` / `list` 两个成员。
import { SessionId } from "@morlay/dsh-session/contract";
import type { Session } from "@morlay/dsh-session/contract";
import { Injectable, type Context, type OnInit } from "@morlay/zephyr";
import type { AgentCancelCause } from "@morlay/dsh-session/contract";
import {
  SessionAgentControl,
  type SessionAgentLike,
} from "../contract/session-agent-control.contract.ts";

/** 上游 `Agent` 上本包用到的那几个成员（上游契约的子集，避免为一个结构读取新增依赖）。 */
interface LiveAgentLike {
  readonly id: SessionId;
  readonly session: Session;
  followup(message: Parameters<SessionAgentLike["followup"]>[0]): void;
  cancel(cause: AgentCancelCause, options?: { readonly keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

/** 上游 `AgentRegistry` 上本包用到的那几个成员。 */
interface AgentDirectoryLike {
  get(id: SessionId): LiveAgentLike | undefined;
  list(): readonly LiveAgentLike[];
}

/**
 * `SessionAgentControl` 的默认实现：每次调用都按服务名 `agents` 现读目录。
 *
 * 目录不在装配里（只跑数据面的宿主、纯端点测试）时 `get` 返回 `undefined`、`list` 返回空表——
 * 编辑编排据此退化成「只重写日志」，与没有这一行时同形。
 */
@Injectable()
export class SessionAgentControlDefault extends SessionAgentControl implements OnInit {
  private row: Context | undefined;

  onInit(ctx: Context): void {
    this.row = ctx;
  }

  get(id: string): SessionAgentLike | undefined {
    const agent = this.directory()?.get(SessionId(id));
    return agent === undefined ? undefined : adapt(agent);
  }

  list(): readonly SessionAgentLike[] {
    return (this.directory()?.list() ?? []).map(adapt);
  }

  // 目录在**调用时**读：它晚于本行挂载（见文件头）。
  private directory(): AgentDirectoryLike | undefined {
    return (
      this.row as unknown as { get(name: string, strict?: boolean): unknown } | undefined
    )?.get("agents", false) as AgentDirectoryLike | undefined;
  }
}

function adapt(agent: LiveAgentLike): SessionAgentLike {
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

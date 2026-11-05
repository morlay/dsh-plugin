// 全链路用例的**宿主半**装配：真 cordis ctx + 真会话库（临时目录 sqlite）+ 真投影注册表 / 检查点 /
// 分支 / 持久化 + 真编辑编排与 wire 端点。
//
// 只有**模型 / agent 环的响应**是替身（`AgentDirectoryStub`）：本包不依赖 agent 域包，而编辑编排的
//「先停 agent、再把用户输入排进重放队列」要一个目录面。替身实现的是上游 `AgentRegistry` 的最小子集
// （`get` / `list`），真正的适配行是本包的 `SessionAgentControlDefault`（按服务名 `agents` 读它）。
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, UserMessage } from "@morlay/dsh-agent/contract";
import {
  Session,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from "@morlay/dsh-session/contract";
import { SessionTurnOutline } from "@morlay/dsh-session";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { SessionPersistenceRdb } from "@morlay/better-session";
import {
  SessionAgentControlDefault,
  SessionEditorEndpointDefault,
} from "@morlay/better-session/server";
import { SessionEditor, SessionEditorDefault } from "@morlay/better-session";
import { createCtx, mountRows, publish, type MountedContext, type RowEntry } from "./base.ts";
import { mountOnto } from "./base.ts";

/** 替身目录里那个「活着的 agent」：真会话 + 记录 followup / cancel。 */
export interface StubAgent {
  readonly id: SessionId;
  readonly session: Session;
  followup(message: UserMessage): void;
  cancel(cause: { readonly kind: "user" }, options?: { readonly keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

// 假模型的固定回复前缀：断言「这一轮是替身产出的」时用它。
export const MOCK_REPLY_PREFIX = "mock reply to: ";

/**
 * `agents` 服务（上游 `AgentRegistry` 的最小子集）的替身：**只**替模型的输出与 turn 推进。
 *
 * `followup` 走真会话的 `append`（事件进内存 log，随后由投影检查点的写路径落库），
 * 所以「排进队列的输入」在库里是真的 `user/message`，不是内存断言。
 */
export class AgentDirectoryStub {
  /** 每次 `followup` 收到的输入（按收到顺序；断言「排进队列」用它）。 */
  readonly followups: UserMessage[] = [];

  /** 每次 `cancel` 的会话与原因（「先停 agent 再动日志」用它）。 */
  readonly cancels: Array<{ id: SessionId; cause: { readonly kind: "user" } }> = [];

  private readonly live = new Map<SessionId, StubAgent>();

  /** 登记一个活着的 agent（本用例里会话是 live 的，才谈得上「正在跑」）。 */
  attach(session: Session): StubAgent {
    const agent: StubAgent = {
      id: session.id,
      session,
      followup: (message) => {
        this.followups.push(message);
        this.appendTurn(session, message);
      },
      cancel: (cause) => {
        this.cancels.push({ id: session.id, cause });
      },
      whenIdle: async () => {},
    };
    this.live.set(session.id, agent);
    return agent;
  }

  get(id: SessionId): StubAgent | undefined {
    return this.live.get(id);
  }

  list(): readonly StubAgent[] {
    return [...this.live.values()];
  }

  // 一轮完整的回合：turn/start → step/start → user/message → assistant/message → step/end → turn/end。
  private appendTurn(session: Session, message: UserMessage): void {
    const turn = lastTurnOf(session.snapshotEvents()) + 1;
    const intent = { surfaceOp: "append" as const };
    session.append("turn/start", { turn });
    session.append("step/start", { turn, step: 1 });
    session.append("user/message", message, intent as never);
    session.append(
      "assistant/message",
      { turn, step: 1, message: mockReply(message), stream: [] },
      intent as never,
    );
    session.append("step/end", { turn, step: 1 });
    session.append("turn/end", { turn, reason: { kind: "completed" } });
  }
}

function mockReply(message: UserMessage): AssistantMessage {
  const text = message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return Object.freeze({
    id: randomUUID(),
    role: "assistant",
    content: Object.freeze([{ type: "text", text: MOCK_REPLY_PREFIX + text }]),
    source: Object.freeze({ kind: "model", provider: "mock", model: "mock" }),
  }) as AssistantMessage;
}

function lastTurnOf(events: readonly SessionEvent[]): number {
  let last = 0;
  for (const event of events) {
    if (event.type === "turn/start" || event.type === "turn/end")
      last = Math.max(last, event.data.turn);
  }
  return last;
}

/** 一份宿主装配。 */
export interface Host {
  readonly ctx: MountedContext;
  readonly root: string;
  readonly dbPath: string;
  readonly persistence: SessionPersistenceRdb;
  /** 真 wire 路由表：端点行就是往它注册的。 */
  readonly handlers: RemoteHandlers;
  /** 真编辑编排（`sessionEditor` 面）。 */
  readonly editor: SessionEditorDefault;
  /** `agents` 替身（模型 / agent 环的响应）。 */
  readonly agentDirectory: AgentDirectoryStub;
  /** 库里读一份日志（读库，不读内存）。 */
  eventsOf(id: string): Promise<readonly SessionEvent[]>;
  /** 库里读一份 header。 */
  headerOf(id: string): Promise<SessionHeader | undefined>;
  dispose(): Promise<void>;
}

export interface HostOptions {
  /** 复用同一个数据根（用例要「重开实例」时传它）。 */
  readonly root?: string;
  /** 装配里不给 `agents` 目录（退化路径：只重写日志、不重放）。 */
  readonly withoutAgents?: boolean;
}

// 端点与编辑编排的那几行：清单在这里，装配在 base（`mountRows`）。
const endpointRows: readonly RowEntry[] = [
  SessionAgentControlDefault as RowEntry,
  SessionEditorDefault as RowEntry,
  RemoteHandlersDefault as RowEntry,
  SessionEditorEndpointDefault as RowEntry,
];

/**
 * 起一份宿主装配。
 * @param options - 数据根与是否装 agent 目录。
 * @returns 装配面。
 */
export async function startHost(options: HostOptions = {}): Promise<Host> {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "better-session-e2e-")));
  const dbPath = join(root, "sessions.sqlite");
  const ctx = createCtx();
  // 真 turnOutline 投影：撤回 / 分叉用例要看检查点水位，没有注册的投影就没有可折的单元。
  await ctx.plugin(SessionTurnOutline);
  const fiber = await mountOnto(ctx, { root, config: { type: "sqlite", path: dbPath } });

  const agentDirectory = new AgentDirectoryStub();
  // 顺序 = 依赖：目录面 → agent 目录适配行 → 编辑编排（装配期注入适配行）→ wire 端点。
  // 目录面在 `before` 里发布：消费它的行在**装配期**就读这个名字。
  const wired = await mountRows(endpointRows, {
    dataDir: root,
    ctx,
    before: (row) => {
      if (options.withoutAgents !== true) publish(row, "agents", agentDirectory);
    },
  });
  // 面的取法与消费方一致：按契约令牌拿，不按行的构造面拿。
  const handlers = wired.get(RemoteHandlers);
  const editor = wired.get(SessionEditor) as SessionEditorDefault;

  const persistence = fiber.persistence;
  return {
    ctx,
    root,
    dbPath,
    persistence,
    handlers,
    editor,
    agentDirectory,
    async eventsOf(id) {
      const reader = await persistence.open(SessionId(id), "read");
      try {
        return (await reader.read()).events;
      } finally {
        await reader.close();
      }
    },
    async headerOf(id) {
      const reader = await persistence.open(SessionId(id), "read").catch(() => undefined);
      if (reader === undefined) return undefined;
      try {
        return reader.header;
      } finally {
        await reader.close();
      }
    },
    async dispose() {
      await wired.dispose().catch(() => undefined);
      await fiber.dispose();
      if (options.root === undefined) {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

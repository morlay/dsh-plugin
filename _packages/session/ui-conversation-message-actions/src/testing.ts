import type { LoggerService } from "@morlay/zephyr";
import { TokenMeter } from "@deepseek-ai/dsh-token-meter";
import {
  Session,
  SessionId as SessionIdBrand,
  SessionSeq,
  SessionStore,
  type SessionEvent,
  type SessionHeader,
} from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import {
  configuredProvider,
  bootstrapApplication,
  Logger,
  type App,
  type ProviderList,
} from "@morlay/zephyr";
import type { SessionPersistenceRdb as SessionPersistenceRdbType } from "@morlay/session-rdb";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import { parseJsonlArtifact } from "@morlay/session-rdb/artifact";
import { meta, oneTurnLog } from "@morlay/session-rdb/testing";
import { SESSION_EDITOR_PATHS } from "./shared.ts";
import { SessionEditor } from "@morlay/ui-conversation-message-actions";
import { Agents } from "@morlay/dsh-base/agent";
import { SessionBranchProvider } from "@morlay/session-rdb/branch";
import { harness as rdbHarness } from "@morlay/session-rdb/testing";

export {
  SESSION_EDITOR_PATHS,
  Session,
  SessionIdBrand,
  SessionSeq,
  SessionStore,
  TokenMeter,
  meta,
  oneTurnLog,
  parseJsonlArtifact,
};
export type { SessionEditorAction } from "./shared.ts";
export type { SessionEvent, SessionHeader };

export interface AgentSlots {
  // 测试在装配后登记 live agent：注册表通过转发器读它（SessionEditor 注入的是同一个转发器）。
  set(registry: AgentRegistryLike): () => void;
  current(): AgentRegistryLike | undefined;
}

export interface AgentRegistryLike {
  get(id: string): unknown;
  create(...args: any[]): unknown;
  resume(...args: any[]): unknown;
  list?(): unknown[];
}

export interface Harness {
  app: App;
  ctx: Awaited<ReturnType<typeof rdbHarness>>["ctx"];
  agents: AgentSlots;
  branch: SessionBranchProvider;
  sessions: SessionStore;
  persistence: SessionPersistenceRdbType;
  editor: SessionEditor;
  logger: LoggerService;
  dispose: () => Promise<void>;
}

/**
 * 装配面：与我们自己的框架一致（bootstrapApplication + Provider/Module）。
 * `extra` 用来注入测试替身（如 agents 的假实现）。
 */
export async function harness(
  extra: ProviderList = [],
  agents?: unknown,
): Promise<Harness> {
  let agentRegistry = agents as AgentRegistryLike | undefined;
  const agentSlots: AgentSlots = {
    set(registry) {
      const previous = agentRegistry;
      agentRegistry = registry;
      return () => {
        agentRegistry = previous;
      };
    },
    current: () => agentRegistry,
  };
  const rdb = await rdbHarness({
    tokenMeter: true,
    providers: [
      SessionEditor,
      {
        provide: Agents,
        useFactory: () => ({
          get available() {
            return agentRegistry !== undefined;
          },
          get: (id: string) => agentRegistry?.get(id),
          create: async (...args: unknown[]) => agentRegistry!.create(...args),
          resume: async (...args: unknown[]) => agentRegistry!.resume(...args),
          list: () => agentRegistry?.list?.() ?? [],
        }),
      },
      ...extra,
    ],
  });
  return {
    app: rdb.app,
    ctx: rdb.ctx,
    agents: agentSlots,
    branch: rdb.branch,
    sessions: rdb.sessions,
    persistence: rdb.persistence as SessionPersistenceRdbType,
    editor: rdb.app.get(SessionEditor),
    logger: rdb.app.get(Logger),
    dispose: () => rdb.app.dispose(),
  };
}

export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function twoTurnLog(): SessionEvent[] {
  const first = oneTurnLog();
  const second: SessionEvent[] = oneTurnLog().map(
    (event) =>
      ({
        ...event,
        seq: event.seq + 6,
        time: event.time + 100,
        data: { ...event.data, turn: 2 },
      }) as SessionEvent,
  );
  return [...first, ...second];
}

export async function createPersisted(
  persistence: SessionPersistence,
  id: string,
  events: readonly SessionEvent[],
  header: SessionHeader = meta(id),
): Promise<void> {
  const handle = await persistence.create(header);
  try {
    await handle.append([...events]);
  } finally {
    await handle.close();
  }
}

export function userMessage(seq: number, id: string, text: string, time = seq): SessionEvent {
  return {
    type: "user/message",
    seq: SessionSeq(seq),
    time,
    data: {
      id,
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    },
    surfaceOp: "append",
  } as unknown as SessionEvent;
}

export function assistantMessage(
  seq: number,
  turn: number,
  step: number,
  id: string,
  text: string,
  time = seq,
): SessionEvent {
  return {
    type: "assistant/message",
    seq: SessionSeq(seq),
    time,
    data: {
      turn,
      step,
      message: {
        id,
        role: "assistant",
        content: [{ type: "text", text }],
        source: { kind: "model", provider: "mock", model: "mock" },
      },
      stream: [] as const,
    },
    surfaceOp: "append",
  } as unknown as SessionEvent;
}

export function turnLog(
  base: number,
  turn: number,
  opts: { users?: Array<{ id: string; text: string }>; closed?: boolean; time?: number } = {},
): SessionEvent[] {
  const { closed = true, time = base } = opts;
  const users = opts.users ?? [{ id: `t${turn}-u1`, text: `turn ${turn} input` }];
  const events: SessionEvent[] = [
    { type: "turn/start", seq: SessionSeq(base), time, data: { turn } },
  ];
  let seq = base + 1;
  let step = 1;
  for (const user of users) {
    events.push({ type: "step/start", seq: SessionSeq(seq++), time, data: { turn, step } });
    events.push(userMessage(seq++, user.id, user.text, time));
    events.push(
      assistantMessage(seq++, turn, step, `${user.id}-a`, `answer to ${user.text}`, time),
    );
    events.push({ type: "step/end", seq: SessionSeq(seq++), time, data: { turn, step } });
    step += 1;
  }
  if (closed) {
    events.push({
      type: "turn/end",
      seq: SessionSeq(seq++),
      time,
      data: { turn, reason: { kind: "completed" } },
    });
  }
  return events;
}

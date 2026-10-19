import type { Context } from "@morlay/zephyr";
import { SessionPersistence, SessionStore } from "@morlay/dsh-base/session";
import { Agents } from "@morlay/dsh-base/agent";
import { WebServer } from "@morlay/dsh-base/web-server";
import { Injectable, inject, Logger, Module } from "@morlay/zephyr";
import type { AssistantMessage, UserMessage } from "@deepseek-ai/dsh-llm";
import { SessionSeq } from "@deepseek-ai/dsh-session";
import type {
  AgentCancelCause,
  Session,
  SessionEvent,
  SessionId,
  SurfaceEventType,
  SurfaceIntent,
} from "@deepseek-ai/dsh-session";
import {
  SessionBranchError,
  SessionBranchProvider,
  balanceRewindPrefix,
  type BranchBoundary,
} from "@morlay/session-rdb/branch";
import type {
  EditOperation,
  RecallOperation,
  RerollOperation,
  RetryOperation,
  SessionEditorResult,
} from "./types.ts";
import {
  SESSION_EDITOR_PATHS,
  type SessionEditorAction,
  type SessionEditorOperation,
  type SessionEditorOperationResult,
} from "./shared.ts";
import {
  closedTurns,
  droppedCompactions,
  editPlan,
  keptOutsideTurn,
  openTurnCloser,
  precedingContentIndex,
  recallBoundary,
  restoreCompactions,
  retryPlan,
  rerollPlan,
} from "./plan.ts";

export type { CascadePolicy, EditableBlockKind } from "@morlay/session-rdb/branch";
export type {
  EditableMessageBlock,
  EditOperation,
  RecallOperation,
  RerollOperation,
  RetryOperation,
  RetryableTurn,
  RewindOperation,
  SessionEditorOperation,
  SessionEditorResult,
} from "./types.ts";

export { closedTurns, editableMessages, retryableTurns } from "./plan.ts";

export interface EditorAgent {
  readonly session: Session;
  followup(message: UserMessage): void;

  whenIdle(): Promise<void>;

  cancel?(cause: AgentCancelCause, options?: { keepInbox?: boolean }): void;
}

export interface EditorAgentHandle {
  readonly agent: EditorAgent;
  dispose(): Promise<void>;
}

export interface EditorAgentRegistry {
  get(sessionId: SessionId): EditorAgent | undefined;
  create(options: {
    sessionId?: SessionId;
    seed?: readonly SessionEvent[];
    meta?: {
      cwd?: string;
      parentSession?: SessionId;
      seedLength?: number;
      agentPreset?: string;
    };
    agentOptions?: { provider: string; model: string; maxTokens?: number };
  }): Promise<EditorAgentHandle>;

  resume(options: {
    resumeSessionId: SessionId;
    agentOptions?: { provider: string; model: string; maxTokens?: number };
  }): Promise<EditorAgentHandle>;
}

function appendLogSeedEvent(events: SessionEvent[], type: string, data: unknown): void {
  events.push({
    type: type as SessionEvent["type"],
    seq: events.length,
    time: Date.now(),
    data: data as SessionEvent["data"],
  } as SessionEvent);
}

function appendSurfaceSeedEvent<T extends SurfaceEventType>(
  events: SessionEvent[],
  type: T,
  data: import("@deepseek-ai/dsh-session").SessionEvent<T>["data"],
  intent: SurfaceIntent,
): void {
  events.push({
    type,
    seq: SessionSeq(events.length),
    time: Date.now(),
    data,
    surfaceOp: intent.surfaceOp,
    ...(intent.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: intent.sourceEventSeqs }),
  } as unknown as SessionEvent<T>);
}

function appendManualTurn(
  events: SessionEvent[],
  manual: { turn: number; user: UserMessage; assistant: AssistantMessage },
): void {
  const { turn, user, assistant } = manual;
  appendLogSeedEvent(events, "turn/start", { turn });
  appendSurfaceSeedEvent(events, "user/message", user, { surfaceOp: "append" });
  appendLogSeedEvent(events, "step/start", { turn, step: 1 });
  appendSurfaceSeedEvent(
    events,
    "assistant/message",
    { turn, step: 1, message: assistant, stream: [] },
    {
      surfaceOp: "append",
    },
  );
  appendLogSeedEvent(events, "step/end", { turn, step: 1 });
  appendLogSeedEvent(events, "turn/end", {
    turn,
    reason: { kind: "completed" },
  });
}

// 边界事件的保留语义（与 session-branch 的 rewind 一致）：turn/end 保留边界事件本身，user/message 丢掉它自己。
function keepFromOf(events: readonly SessionEvent[], boundary: number): number {
  if (boundary < 0) return 0;
  return events[boundary]?.type === "turn/end" ? boundary + 1 : boundary;
}

async function appendSeedSuffixLive(
  session: Session,
  seedSuffix: readonly SessionEvent[],
): Promise<void> {
  for (const event of seedSuffix) {
    const s = session as unknown as {
      append(
        type: string,
        data: unknown,
        opts?: { surfaceOp?: unknown; sourceEventSeqs?: readonly number[] },
      ): SessionEvent;
    };
    const raw = event as SessionEvent & {
      surfaceOp?: unknown;
      sourceEventSeqs?: readonly number[];
    };
    if (raw.surfaceOp !== undefined) {
      s.append(event.type, event.data, {
        surfaceOp: raw.surfaceOp,
        ...(raw.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: raw.sourceEventSeqs }),
      });
    } else {
      s.append(event.type, event.data);
    }
  }
}

@Injectable()
export class SessionEditor {
  sessions = inject(SessionStore);

  sessionPersistence = inject(SessionPersistence);

  branch = inject(SessionBranchProvider);

  logger = inject(Logger);

  // 极简装配里可能没有 agents / web 面：缺席时安静跳过。
  agents = inject.optional(Agents);

  webServer = inject.optional(WebServer);

  onInit(ctx: Context): void {
    const webServer = this.webServer;
    if (webServer === undefined) return;
    // 一条动作一条 exact 路由：动作由路径定，body 里不带 `action`（见 shared.ts 的 SESSION_EDITOR_PATHS）。
    for (const [action, path] of Object.entries(SESSION_EDITOR_PATHS)) {
      const verb = action as SessionEditorAction;
      ctx.effect(
        () =>
          webServer.register({
            kind: "exact",
            path,
            handler: (request, response) =>
              handleRoute(
                this,
                verb,
                request as unknown as HttpRequestLike,
                response as unknown as HttpResponseLike,
              ),
          }),
        `session-editor: HTTP route ${path}`,
      );
    }
  }

  readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode?: "after" | "before",
    signal?: AbortSignal,
  ): Promise<BranchBoundary> {
    return this.branch.readBranchPrefix(id, atSeq, mode, signal);
  }

  fork(
    sourceId: SessionId,
    atSeq?: number,
    childSessionId?: SessionId,
    meta?: { cwd?: string; agentPreset?: string },
    signal?: AbortSignal,
  ): Promise<SessionId> {
    return this.branch.forkFrom(
      sourceId,
      {
        ...(atSeq === undefined ? {} : { atSeq }),
        ...(childSessionId === undefined ? {} : { childSessionId }),
        ...(meta === undefined ? {} : { meta }),
      },
      signal,
    );
  }

  async rewind(id: SessionId, toBoundary: number, signal?: AbortSignal) {
    await this.stopLoop(id, signal);
    return this.branch.rewind(id, toBoundary, signal);
  }

  edit(operation: EditOperation, signal?: AbortSignal): Promise<SessionEditorResult> {
    return this.branchOperation(operation, signal);
  }

  reroll(operation: RerollOperation, signal?: AbortSignal): Promise<SessionEditorResult> {
    return this.branchOperation(operation, signal);
  }

  retry(operation: RetryOperation, signal?: AbortSignal): Promise<SessionEditorResult> {
    return this.branchOperation(operation, signal);
  }

  recall(operation: RecallOperation, signal?: AbortSignal): Promise<SessionEditorResult> {
    return this.recallOperation(operation, signal);
  }

  private async branchOperation(
    operation: EditOperation | RerollOperation | RetryOperation,
    signal?: AbortSignal,
  ): Promise<SessionEditorResult> {
    signal?.throwIfAborted();
    const events = await this.readEvents(operation.sessionId, signal);
    const turns = closedTurns(events);
    const plan =
      operation.action === "edit"
        ? editPlan(operation, turns)
        : operation.action === "retry"
          ? retryPlan(operation, turns)
          : rerollPlan(operation, turns);

    const headerConfig = events.findLast((event) => event.type === "request/header")?.data.header
      .config;

    const turnIndex = turns.findIndex((turn) => turn.startSeq === plan.anchorSeq);

    const preceding = precedingContentIndex(turns, turnIndex);
    const boundary =
      plan.rewindBoundary !== undefined
        ? plan.rewindBoundary
        : preceding < 0
          ? -1
          : turns[preceding]!.endSeq!;
    // 补回被截断丢掉、但在重放目标之前的压缩
    const keepFrom = keepFromOf(events, boundary);
    const compactions = droppedCompactions(events, keepFrom, plan.targetSeq);
    // 同理保留这之前的非轮次事件（配置 / 上下文注入 / 队伍 / 请求头…）；首轮撤回等同清空重开
    const preserved = boundary === -1 ? [] : keptOutsideTurn(events, keepFrom, plan.targetSeq);
    // 切点落在轮内：保留前缀尾部是未闭合轮，补 interrupted closer
    const closer = openTurnCloser(events, keepFrom);

    const replayTurn = preceding < 0 ? 1 : turns[preceding]!.turn + 1;

    const manualSeed: SessionEvent[] = [];
    if (plan.manualTurn !== undefined) {
      appendManualTurn(manualSeed, { ...plan.manualTurn, turn: replayTurn });
    }

    const replay = await this.prepareReplay(
      operation.sessionId,
      plan.queuedUsers,
      signal,
      headerConfig,
    );

    await this.stopLoop(operation.sessionId, signal);
    const live = this.sessions.get(operation.sessionId);
    await this.branch.rewind(operation.sessionId, boundary, signal);
    // 补回的压缩落在重放的输入之前
    const seedStart = this.seedStart(live, events, keepFrom);
    const seedSuffix: SessionEvent[] = [
      ...restoreCompactions(compactions, keepFrom, seedStart),
      ...preserved,
      ...(closer === undefined ? [] : [closer]),
      ...manualSeed,
    ];
    await this.appendSeedSuffix(operation.sessionId, live, seedSuffix, events, keepFrom);

    let queuedTurns = 0;
    if (replay.agent !== undefined && plan.queuedUsers.length > 0) {
      const lastSeedTurn = seedSuffix.findLast((event) => event.type === "turn/start")?.data.turn;
      if (lastSeedTurn !== undefined) {
        const phase = (replay.agent as unknown as { phase?: { lastTurn?: number } }).phase;
        if (phase !== undefined) phase.lastTurn = lastSeedTurn;
      }
      for (const message of plan.queuedUsers) replay.agent.followup(message);
      await this.sessions.flush(replay.agent.session);
      queuedTurns = plan.queuedUsers.length;
    }
    return {
      sessionId: operation.sessionId,
      queuedTurns,

      live: this.sessions.get(operation.sessionId) !== undefined,
    };
  }

  private async recallOperation(
    operation: RecallOperation,
    signal?: AbortSignal,
  ): Promise<SessionEditorResult> {
    signal?.throwIfAborted();
    const events = await this.readEvents(operation.sessionId, signal);
    const boundary = recallBoundary(events, closedTurns(events), operation.eventSeq);
    // 撤回同样要补回被丢掉、但在撤回目标之前的非轮次事件（配置 / 压缩 / 上下文注入 / 队伍…）；
    // 首轮撤回等同清空重开
    const keepFrom = keepFromOf(events, boundary);
    const compactions =
      boundary === -1 ? [] : droppedCompactions(events, keepFrom, operation.eventSeq);
    const preserved = boundary === -1 ? [] : keptOutsideTurn(events, keepFrom, operation.eventSeq);
    // 轮内 followup 撤回：保留前缀尾部是未闭合轮，补 interrupted closer
    const closer = openTurnCloser(events, keepFrom);

    await this.stopLoop(operation.sessionId, signal);
    const live = this.sessions.get(operation.sessionId);
    await this.branch.rewind(operation.sessionId, boundary, signal);
    await this.appendSeedSuffix(
      operation.sessionId,
      live,
      [
        ...restoreCompactions(compactions, keepFrom, this.seedStart(live, events, keepFrom)),
        ...preserved,
        ...(closer === undefined ? [] : [closer]),
      ],
      events,
      keepFrom,
    );
    return {
      sessionId: operation.sessionId,
      queuedTurns: 0,
      live: this.sessions.get(operation.sessionId) !== undefined,
    };
  }

  // 种子后缀的起点 seq：live 会话是被截断后的日志长度，cold 会话是配平后的保留前缀长度
  private seedStart(
    live: Session | undefined,
    events: readonly SessionEvent[],
    keepFrom: number,
  ): number {
    return live === undefined
      ? balanceRewindPrefix(events.slice(0, keepFrom)).length
      : Number(live.seq);
  }

  private async appendSeedSuffix(
    sessionId: SessionId,
    live: Session | undefined,
    seedSuffix: readonly SessionEvent[],
    events: readonly SessionEvent[],
    keepFrom: number,
  ): Promise<void> {
    if (seedSuffix.length === 0) return;
    if (live !== undefined) {
      await this.sessions.flush(live);
      await appendSeedSuffixLive(live, seedSuffix);
      await this.sessions.flush(live);
      return;
    }

    const keepLength = balanceRewindPrefix(events.slice(0, keepFrom)).length;
    const renumbered = seedSuffix.map(
      (event, index) =>
        ({
          ...event,
          seq: keepLength + index,
        }) as SessionEvent,
    );
    const handle = await this.sessionPersistence.open(sessionId, "write");
    try {
      await handle.append(renumbered);
    } finally {
      await handle.close();
    }
  }

  private async stopLoop(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const agents = this.agents as EditorAgentRegistry | undefined;
    const existing = agents?.get(sessionId);
    if (existing === undefined) return;
    existing.cancel?.({ kind: "user" }, { keepInbox: true });
    await existing.whenIdle();
    signal?.throwIfAborted();
  }

  private async readEvents(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<readonly SessionEvent[]> {
    const live = this.sessions.get(sessionId);
    if (live !== undefined) return live.snapshotEvents();

    const branch = this.branch as unknown as {
      readRawEvents(
        id: SessionId,
        signal?: AbortSignal,
      ): Promise<{ meta: unknown; events: readonly SessionEvent[] }>;
    };
    return (await branch.readRawEvents(sessionId, signal)).events;
  }

  private async prepareReplay(
    sessionId: SessionId,
    queuedUsers: readonly UserMessage[],
    signal: AbortSignal | undefined,
    headerConfig?: { provider?: string; model?: string; maxTokens?: number },
  ): Promise<{ agent: EditorAgent | undefined }> {
    if (queuedUsers.length === 0) return { agent: undefined };
    signal?.throwIfAborted();
    const agents = this.agents as EditorAgentRegistry | undefined;
    if (agents === undefined) return { agent: undefined };
    const existing = agents.get(sessionId);
    if (existing !== undefined) {
      return { agent: existing };
    }
    // 注册表存在但不可用（极简装配 / 测试替身）：与「没有 agents」同义，不重放。
    if (
      (agents as { available?: boolean }).available === false ||
      typeof (agents as { resume?: unknown }).resume !== "function"
    ) {
      return { agent: undefined };
    }

    const provider = headerConfig?.provider ?? "";
    const model = headerConfig?.model ?? "";
    if (provider.length === 0 || model.length === 0) {
      const events = await this.readEvents(sessionId, signal);
      const config = events.findLast((event) => event.type === "request/header")?.data.header
        .config;
      const fallbackProvider = config?.provider ?? "";
      const fallbackModel = config?.model ?? "";
      if (fallbackProvider.length === 0 || fallbackModel.length === 0) {
        throw new SessionBranchError("无法重放：会话没有可解析的模型配置。", "INVALID_BOUNDARY");
      }
      const handle = await agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: fallbackProvider, model: fallbackModel },
      });
      signal?.throwIfAborted();
      return { agent: handle.agent };
    }
    const handle = await agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider, model },
    });
    signal?.throwIfAborted();
    return { agent: handle.agent };
  }
}

export default SessionEditor;

interface HttpRequestLike {
  method?: string;
  url?: string;
  on(event: "data", listener: (chunk: Uint8Array | string) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: unknown) => void): this;
}

interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown;
  end(body?: string): void;
}

interface HttpServerLike {
  register(route: {
    kind: "exact";
    path: string;
    handler: (request: HttpRequestLike, response: HttpResponseLike) => void | Promise<void>;
  }): () => void;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("请求体必须是 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

function sessionIdOf(value: unknown): SessionId {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("sessionId 必须是非空字符串。");
  return value as SessionId;
}

function integerOf(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} 必须是非负安全整数。`);
  }
  return value as number;
}

function cascadeOf(value: unknown): import("@morlay/session-rdb/branch").CascadePolicy {
  if (value !== "truncate" && value !== "preserve")
    throw new TypeError("cascade 必须是 truncate 或 preserve。");
  return value;
}

function decodeOperation(value: unknown, action: SessionEditorAction): SessionEditorOperation {
  const record = objectValue(value);
  const sessionId = sessionIdOf(record["sessionId"]);
  switch (action) {
    case "edit":
      if (typeof record["text"] !== "string") throw new TypeError("text 必须是字符串。");
      return {
        action: "edit",
        sessionId,
        eventSeq: integerOf(record["eventSeq"], "eventSeq"),
        blockIndex: integerOf(record["blockIndex"], "blockIndex"),
        text: record["text"],
        cascade: cascadeOf(record["cascade"]),
      };
    case "reroll":
      return { action: "reroll", sessionId };
    case "retry":
      return {
        action: "retry",
        sessionId,
        turn: integerOf(record["turn"], "turn"),
        cascade: cascadeOf(record["cascade"]),
      };
    case "rewind":
      return {
        action: "rewind",
        sessionId,
        toBoundary: integerOf(record["toBoundary"], "toBoundary"),
      };
    case "recall":
      return {
        action: "recall",
        sessionId,
        eventSeq: integerOf(record["eventSeq"], "eventSeq"),
      };
    case "fork":
      return {
        action: "fork",
        sessionId,
        ...(record["atSeq"] === undefined ? {} : { atSeq: integerOf(record["atSeq"], "atSeq") }),
        ...(record["childSessionId"] === undefined
          ? {}
          : { childSessionId: sessionIdOf(record["childSessionId"]) }),
      };
    default:
      throw new TypeError("action 必须是 edit、reroll、retry、rewind、recall 或 fork。");
  }
}

function requestJson(request: HttpRequestLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = "";
    request.on("data", (chunk) => {
      text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    });
    request.on("end", () => {
      try {
        text += decoder.decode();
        resolve(JSON.parse(text) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function respondJson(response: HttpResponseLike, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function runOperation(
  editor: SessionEditor,
  operation: SessionEditorOperation,
): Promise<SessionEditorOperationResult> {
  switch (operation.action) {
    case "edit": {
      const result = await editor.edit(operation);
      return {
        sessionId: result.sessionId,
        queuedTurns: result.queuedTurns,
        ...(result.live === undefined ? {} : { live: result.live }),
      };
    }
    case "reroll": {
      const result = await editor.reroll(operation);
      return {
        sessionId: result.sessionId,
        queuedTurns: result.queuedTurns,
        ...(result.live === undefined ? {} : { live: result.live }),
      };
    }
    case "retry": {
      const result = await editor.retry(operation);
      return {
        sessionId: result.sessionId,
        queuedTurns: result.queuedTurns,
        ...(result.live === undefined ? {} : { live: result.live }),
      };
    }
    case "rewind":
      await editor.rewind(operation.sessionId, operation.toBoundary);
      return { sessionId: operation.sessionId, queuedTurns: 0 };
    case "recall": {
      const result = await editor.recall(operation);
      return {
        sessionId: result.sessionId,
        queuedTurns: result.queuedTurns,
        ...(result.live === undefined ? {} : { live: result.live }),
      };
    }
    case "fork":
      return {
        sessionId: await editor.fork(
          operation.sessionId,
          operation.atSeq,
          operation.childSessionId,
        ),
        queuedTurns: 0,
      };
  }
}

async function handleRoute(
  editor: SessionEditor,
  action: SessionEditorAction,
  request: HttpRequestLike,
  response: HttpResponseLike,
): Promise<void> {
  try {
    if (request.method === "POST") {
      respondJson(
        response,
        200,
        await runOperation(editor, decodeOperation(await requestJson(request), action)),
      );
      return;
    }
    response.writeHead(405);
    response.end();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    respondJson(response, error instanceof TypeError ? 400 : 409, {
      error: message,
    });
  }
}

// 本包的一行（`@morlay/ui-conversation-message-actions/cordis-register`）：HTTP 面与 client 槽位注册
// 都由 `SessionEditor` 承担；构建期生成器按 `row` 只写一行。
@Module({ providers: [SessionEditor] })
export class SessionEditorModule {}

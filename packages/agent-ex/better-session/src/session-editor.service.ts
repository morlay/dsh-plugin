// 编辑编排：编辑 / 重掷 / 重试 / 撤回 / 分叉 / 回退六条动作的语义在这里（日志怎么改在 `plan.ts` 与分支行）。
import type { AssistantMessage, UserMessage } from "@morlay/dsh-agent/contract";
import { SessionId, SessionSeq } from "@morlay/dsh-session/contract";
import type { Session, SessionEvent } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionStore } from "@morlay/dsh-session";
import { inject, Injectable, Logger, type OnInit } from "@morlay/zephyr";
import { SessionBranch } from "./contract/session-branch.contract.ts";
import { SessionBranchError } from "./endpoint/branch.ts";
import type {
  SessionEditRequest,
  SessionRecallRequest,
  SessionRerollRequest,
  SessionRetryRequest,
} from "./endpoint/session-editor-endpoint.ts";
import type { SessionEditorValue } from "./endpoint/session-editor-endpoint.ts";
import { SessionEditor } from "./contract/session-editor.contract.ts";
import {
  SessionAgentControl,
  type SessionAgentLike,
} from "./contract/session-agent-control.contract.ts";
import { asRdbStore } from "./contract/session-rdb-store.contract.ts";
import { balanceRewindPrefix } from "./endpoint/balance.ts";
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

@Injectable()
export class SessionEditorDefault extends SessionEditor implements OnInit {
  private readonly branch = inject(SessionBranch);

  private readonly persistence = inject(SessionPersistence);

  private readonly sessions = inject(SessionStore);

  private readonly agents = inject.optional(SessionAgentControl);

  private readonly logger = inject(Logger);

  onInit(): void {}

  readBranchPrefix(id: SessionId, atSeq?: number, mode?: "after" | "before", signal?: AbortSignal) {
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

  async rewind(id: SessionId, toBoundary: number, signal?: AbortSignal): Promise<void> {
    await this.stopLoop(id, signal);
    await this.branch.rewind(id, toBoundary, signal);
  }

  edit(request: SessionEditRequest, signal?: AbortSignal): Promise<SessionEditorValue> {
    return this.branchOperation(request, signal);
  }

  reroll(request: SessionRerollRequest, signal?: AbortSignal): Promise<SessionEditorValue> {
    return this.branchOperation(request, signal);
  }

  retry(request: SessionRetryRequest, signal?: AbortSignal): Promise<SessionEditorValue> {
    return this.branchOperation(request, signal);
  }

  recall(request: SessionRecallRequest, signal?: AbortSignal): Promise<SessionEditorValue> {
    return this.recallOperation(request, signal);
  }

  private async branchOperation(
    request: SessionEditRequest | SessionRerollRequest | SessionRetryRequest,
    signal?: AbortSignal,
  ): Promise<SessionEditorValue> {
    signal?.throwIfAborted();
    const sessionId = toSessionId(request.sessionId);
    const events = await this.readEvents(sessionId, signal);
    const turns = closedTurns(events);
    const plan =
      "turn" in request
        ? retryPlan(request, turns)
        : "eventSeq" in request
          ? editPlan(request, turns)
          : rerollPlan(request, turns);

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
    // 补回被截断丢掉、但在重放目标之前的压缩。
    const keepFrom = keepFromOf(events, boundary);
    const compactions = droppedCompactions(events, keepFrom, plan.targetSeq);
    // 同理保留这之前的非轮次事件（配置 / 上下文注入 / 请求头…）；首轮（boundary -1）同样适用。
    const preserved = keptOutsideTurn(events, keepFrom, plan.targetSeq);
    const closer = openTurnCloser(events, keepFrom);

    const replayTurn = preceding < 0 ? 1 : turns[preceding]!.turn + 1;
    const manualSeed: SessionEvent[] = [];
    if (plan.manualTurn !== undefined) {
      appendManualTurn(manualSeed, { ...plan.manualTurn, turn: replayTurn });
    }

    const replay = await this.prepareReplay(
      sessionId,
      plan.queuedUsers,
      signal,
      headerConfig,
      events,
    );

    await this.stopLoop(sessionId, signal);
    const live = this.sessions.get(sessionId);
    await this.branch.rewind(sessionId, boundary, signal);
    const seedStart = this.seedStart(events, keepFrom);
    const seedSuffix: SessionEvent[] = [
      ...restoreCompactions(compactions, keepFrom, seedStart),
      ...preserved,
      ...(closer === undefined ? [] : [closer]),
      ...manualSeed,
    ];
    await this.appendSeedSuffix(sessionId, live, seedSuffix, events, keepFrom);

    let queuedTurns = 0;
    if (replay !== undefined && plan.queuedUsers.length > 0) {
      const lastSeedTurn = seedSuffix.findLast((event) => event.type === "turn/start")?.data.turn;
      if (lastSeedTurn !== undefined) {
        const phase = (replay as unknown as { phase?: { lastTurn?: number } }).phase;
        if (phase !== undefined) phase.lastTurn = lastSeedTurn;
      }
      for (const message of plan.queuedUsers) replay.followup(message);
      await this.sessions.flush(replay.session);
      queuedTurns = plan.queuedUsers.length;
    }
    return {
      sessionId,
      queuedTurns,
      live: this.sessions.get(sessionId) !== undefined,
    };
  }

  private async recallOperation(
    request: SessionRecallRequest,
    signal?: AbortSignal,
  ): Promise<SessionEditorValue> {
    signal?.throwIfAborted();
    const sessionId = toSessionId(request.sessionId);
    const events = await this.readEvents(sessionId, signal);
    const boundary = recallBoundary(events, closedTurns(events), request.eventSeq);
    // 撤回同样要补回被丢掉、但在撤回目标之前的非轮次事件；首轮（boundary -1）同样适用。
    const keepFrom = keepFromOf(events, boundary);
    const compactions = droppedCompactions(events, keepFrom, request.eventSeq);
    const preserved = keptOutsideTurn(events, keepFrom, request.eventSeq);
    const closer = openTurnCloser(events, keepFrom);

    await this.stopLoop(sessionId, signal);
    const live = this.sessions.get(sessionId);
    await this.branch.rewind(sessionId, boundary, signal);
    await this.appendSeedSuffix(
      sessionId,
      live,
      [
        ...restoreCompactions(compactions, keepFrom, this.seedStart(events, keepFrom)),
        ...preserved,
        ...(closer === undefined ? [] : [closer]),
      ],
      events,
      keepFrom,
    );
    return {
      sessionId,
      queuedTurns: 0,
      live: this.sessions.get(sessionId) !== undefined,
    };
  }

  // 种子后缀的起点 seq：配平后的保留前缀长度（存储坐标）。
  private seedStart(events: readonly SessionEvent[], keepFrom: number): number {
    return balanceRewindPrefix(events.slice(0, keepFrom)).length;
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
      appendSeedSuffixLive(live, seedSuffix);
      await this.sessions.flush(live);
      return;
    }

    const keepLength = this.seedStart(events, keepFrom);
    const renumbered = seedSuffix.map(
      (event, index) => ({ ...event, seq: SessionSeq(keepLength + index) }) as SessionEvent,
    );
    const handle = await this.persistence.open(sessionId, "write");
    try {
      await handle.append(renumbered);
    } finally {
      await handle.close();
    }
  }

  private async stopLoop(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const existing = this.agents?.get(sessionId);
    if (existing === undefined) return;
    existing.cancel?.({ kind: "user" }, { keepInbox: true });
    await existing.whenIdle();
    signal?.throwIfAborted();
  }

  private async readEvents(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<readonly SessionEvent[]> {
    // 撤回边界只能在**存储坐标**上算：内存 log 的 seq 是上游按 log.length 自增的，落后 / 超前于存储时两个
    // 坐标不是一回事。持久化是唯一真源，这里恒读库。
    const store = asRdbStore(this.persistence);
    return (await store.readRawEvents(sessionId, signal)).events;
  }

  private async prepareReplay(
    sessionId: SessionId,
    queuedUsers: readonly UserMessage[],
    signal: AbortSignal | undefined,
    headerConfig: { provider?: string; model?: string; maxTokens?: number } | undefined,
    events: readonly SessionEvent[],
  ): Promise<SessionAgentLike | undefined> {
    if (queuedUsers.length === 0) return undefined;
    signal?.throwIfAborted();
    // 装配里没有 agent 目录：只重写日志，不重放（撤回 / 编辑的正确性由日志决定）。
    if (this.agents === undefined) return undefined;
    const existing = this.agents.get(sessionId);
    if (existing !== undefined) return existing;

    const provider = headerConfig?.provider ?? "";
    const model = headerConfig?.model ?? "";
    if (provider.length === 0 || model.length === 0) {
      const config = events.findLast((event) => event.type === "request/header")?.data.header
        .config;
      if ((config?.provider ?? "").length === 0 || (config?.model ?? "").length === 0) {
        throw new SessionBranchError("无法重放：会话没有可解析的模型配置。", "INVALID_BOUNDARY");
      }
    }
    this.logger.warn(
      `session-editor: 会话 "${sessionId}" 需要重放，但装配里没有 agent 目录；本次只重写了日志`,
    );
    return undefined;
  }
}

// 边界事件的保留语义（与分支行的 rewind 一致）：turn/end 保留边界事件本身，user/message 丢掉它自己。
function keepFromOf(events: readonly SessionEvent[], boundary: number): number {
  if (boundary < 0) return 0;
  return events[boundary]?.type === "turn/end" ? boundary + 1 : boundary;
}

function appendSeedSuffixLive(session: Session, seedSuffix: readonly SessionEvent[]): void {
  for (const event of seedSuffix) {
    const target = session as unknown as {
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
    if (raw.surfaceOp === undefined) {
      target.append(event.type, event.data);
    } else {
      target.append(event.type, event.data, {
        surfaceOp: raw.surfaceOp,
        ...(raw.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: raw.sourceEventSeqs }),
      });
    }
  }
}

function appendLogSeedEvent(events: SessionEvent[], type: string, data: unknown): void {
  events.push({
    type: type as SessionEvent["type"],
    seq: SessionSeq(events.length),
    time: Date.now(),
    data: data as SessionEvent["data"],
  } as SessionEvent);
}

function appendSurfaceSeedEvent<T extends "user/message" | "assistant/message">(
  events: SessionEvent[],
  type: T,
  data: SessionEvent<T>["data"],
  intent: { surfaceOp: unknown; sourceEventSeqs?: readonly number[] },
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
    { surfaceOp: "append" },
  );
  appendLogSeedEvent(events, "step/end", { turn, step: 1 });
  appendLogSeedEvent(events, "turn/end", { turn, reason: { kind: "completed" } });
}

function toSessionId(id: string): SessionId {
  return SessionId(id);
}

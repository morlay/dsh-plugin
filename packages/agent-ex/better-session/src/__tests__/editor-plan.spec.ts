// 编辑计划的语义：闭合回合的识别、可编辑块、撤回边界、重试 / 重掷的目标、与压缩事务的保留。
//
// 判据是"操作语义"（撤回哪一个回合、重放哪些用户输入、哪些非轮次事件要留），不是实现细节。
import type { SessionEvent } from "@morlay/dsh-session/contract";
import {
  closedTurns,
  droppedCompactions,
  editPlan,
  editableMessages,
  keptOutsideTurn,
  openTurnCloser,
  precedingContentIndex,
  recallBoundary,
  restoreCompactions,
  retryableTurns,
  retryPlan,
  rerollPlan,
} from "@morlay/better-session";
import { describe, expect, it } from "vitest";
import { turnLog } from "@morlay/dsh-session/testing";

// 编辑请求按契约的形状给（动作由调用哪个方法定，请求里没有 action 字段）。
function editRequest(
  eventSeq: number,
  blockIndex: number,
  text: string,
  cascade: "truncate" | "preserve" = "truncate",
) {
  return { sessionId: "s1", eventSeq, blockIndex, text, cascade };
}

describe("closedTurns", () => {
  it("把日志切成回合，并标出闭合与否与其中的用户 / 助手消息", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2, { closed: false })];

    const turns = closedTurns(events);

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turn: 1, closed: true, startSeq: 0, endSeq: 5 });
    expect(turns[0]?.users).toHaveLength(1);
    expect(turns[0]?.assistants).toHaveLength(1);
    expect(turns[1]).toMatchObject({ turn: 2, closed: false, startSeq: 6 });
  });

  it("第一个 turn/start 之前的事件不属于任何回合", () => {
    const prelude = {
      type: "request/header",
      seq: 0,
      time: 0,
      data: { header: {} },
    } as unknown as SessionEvent;
    const shifted = turnLog(1, 1);

    const turns = closedTurns([prelude, ...shifted]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.startSeq).toBe(1);
  });
});

describe("editableMessages / retryableTurns", () => {
  it("用户消息的每个文本块都可编辑，未闭合回合的助手消息不算", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2, { closed: false })];

    const blocks = editableMessages(closedTurns(events));

    const kinds = blocks.map((block) => block.kind);
    expect(kinds).toEqual(["user", "assistant.response", "user"]);
    expect(blocks[1]).toMatchObject({ eventSeq: 3, kind: "assistant.response" });
  });

  it("可重试的回合只含已闭合且有用户输入的", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2, { closed: false })];

    const retryable = retryableTurns(closedTurns(events));

    expect(retryable).toHaveLength(1);
    expect(retryable[0]).toMatchObject({ turn: 1, userEventSeq: 2, preview: "turn 1 input" });
  });
});

describe("editPlan", () => {
  it("编辑轮内第一条用户消息：不设 rewindBoundary（退到前一轮 turn/end 整轮重放）", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2)];
    const plan = editPlan(editRequest(8, 0, "改过"), closedTurns(events));

    expect(plan.anchorSeq).toBe(6);
    expect(plan.rewindBoundary).toBeUndefined();
    expect(plan.queuedUsers.map((user) => user.content)).toEqual([
      [{ type: "text", text: "改过" }],
    ]);
    expect(plan.targetSeq).toBe(8);
  });

  it("编辑轮内第一条之后的用户消息：rewindBoundary 是这条消息自己的 seq", () => {
    const events = turnLog(0, 1, {
      users: [
        { id: "u1", text: "a" },
        { id: "u2", text: "b" },
      ],
    });
    const plan = editPlan(editRequest(6, 0, "改过"), closedTurns(events));

    // 两个用户消息的 seq 分别是 2 与 6（每个 step 四条事件）。
    expect(plan.rewindBoundary).toBe(6);
  });

  it("preserve 会把下游回合的用户输入一并排队重放", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2)];
    const plan = editPlan(editRequest(2, 0, "改过", "preserve"), closedTurns(events));

    expect(plan.queuedUsers.map((user) => user.content)).toEqual([
      [{ type: "text", text: "改过" }],
      [{ type: "text", text: "turn 2 input" }],
    ]);
  });

  it("编辑助手消息时生成一个手动回合（用户输入 + 替换后的助手消息）", () => {
    const events = turnLog(0, 1);
    const plan = editPlan(editRequest(3, 0, "改过的回答"), closedTurns(events));

    expect(plan.manualTurn?.assistant.content).toEqual([{ type: "text", text: "改过的回答" }]);
    expect(plan.manualTurn?.user.content).toEqual([{ type: "text", text: "turn 1 input" }]);
    expect(plan.queuedUsers).toEqual([]);
  });

  it("不属于任何回合的 seq 被拒绝", () => {
    expect(() => editPlan(editRequest(999, 0, "x"), closedTurns(turnLog(0, 1)))).toThrow(
      /不属于已落定回合/,
    );
  });
});

describe("retryPlan / rerollPlan", () => {
  it("retry 排的是该回合自己的用户输入", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2)];
    const plan = retryPlan({ sessionId: "s1", turn: 2, cascade: "truncate" }, closedTurns(events));

    expect(plan.anchorSeq).toBe(6);
    expect(plan.queuedUsers).toHaveLength(1);
    expect(plan.targetSeq).toBe(8);
  });

  it("reroll 排的是最后一个有助手正文的闭合回合", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2)];
    const plan = rerollPlan({ sessionId: "s1" }, closedTurns(events));

    expect(plan.anchorSeq).toBe(6);
    expect(plan.queuedUsers).toHaveLength(1);
  });

  it("没有可重掷的回合时报错", () => {
    expect(() => rerollPlan({ sessionId: "s1" }, closedTurns([]))).toThrow(/没有可重生成/);
  });
});

describe("recallBoundary", () => {
  it("轮内第一条用户消息退到前一轮 turn/end（撤回整轮）", () => {
    const events = [...turnLog(0, 1), ...turnLog(6, 2)];

    expect(recallBoundary(events, closedTurns(events), 8)).toBe(5);
  });

  it("首轮第一条用户消息退到 -1（会话前导由调用方补回）", () => {
    const events = turnLog(0, 1);

    expect(recallBoundary(events, closedTurns(events), 2)).toBe(-1);
  });

  it("轮内 followup 退到它自己的 seq", () => {
    const events = turnLog(0, 1, {
      users: [
        { id: "u1", text: "a" },
        { id: "u2", text: "b" },
      ],
    });

    expect(recallBoundary(events, closedTurns(events), 6)).toBe(6);
  });

  it("不在任何回合里的 seq 被拒绝", () => {
    expect(() => recallBoundary(turnLog(0, 1), closedTurns(turnLog(0, 1)), 999)).toThrow(
      /不属于已落定回合/,
    );
  });
});

describe("keptOutsideTurn / openTurnCloser", () => {
  it("保留前缀与目标之间、不属于轮次正文的事件（配置 / 上下文注入）", () => {
    const header = {
      type: "request/header",
      seq: 1,
      time: 1,
      data: { header: { config: { provider: "p", model: "m" } } },
    } as unknown as SessionEvent;
    const events = [
      { type: "turn/start", seq: 0, time: 0, data: { turn: 1 } } as unknown as SessionEvent,
      header,
    ];
    const withUser = [...events, ...turnLog(2, 1).slice(1)];

    const kept = keptOutsideTurn(withUser, 0, 3);

    expect(kept.map((event) => event.type)).toEqual(["request/header"]);
  });

  it("保留前缀停在未闭合的轮上时补一条 interrupted closer", () => {
    const events = turnLog(0, 1, { closed: false });

    const closer = openTurnCloser(events, events.length);

    expect(closer?.type).toBe("turn/end");
    expect(closer?.data).toMatchObject({ turn: 1, reason: { kind: "interrupted" } });
  });

  it("保留前缀已经闭合时不补 closer", () => {
    const events = turnLog(0, 1);

    expect(openTurnCloser(events, events.length)).toBeUndefined();
  });
});

describe("压缩事务", () => {
  function compactionBundle(base: number) {
    return [
      { type: "compaction/start", seq: base, time: base, data: { turn: null } },
      {
        type: "compaction/summary",
        seq: base + 1,
        time: base + 1,
        data: { turn: null, shadowedSeqs: [base - 2, base - 1] },
      },
      {
        type: "user/message",
        seq: base + 2,
        time: base + 2,
        data: {
          id: "checkpoint",
          role: "user",
          content: [{ type: "text", text: "summary" }],
          source: { kind: "compact-checkpoint" },
        },
        surfaceOp: { op: "replace", startSeq: base - 2, endSeq: base - 1 },
        sourceEventSeqs: [base, base + 1],
      },
      { type: "compaction/end", seq: base + 3, time: base + 3, data: { turn: null } },
    ] as unknown as SessionEvent[];
  }

  it("droppedCompactions 挑出被截断但仍落在目标之前的完整事务", () => {
    const events = [...turnLog(0, 1), ...compactionBundle(6), ...turnLog(10, 2)];

    const dropped = droppedCompactions(events, 6, 10);

    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.start.seq).toBe(6);
  });

  it("restoreCompactions 把事务重排到 base 起的连续 seq 并重算替换范围引用", () => {
    const events = [...turnLog(0, 1), ...compactionBundle(6)];
    const dropped = droppedCompactions(events, 6, 99);

    const restored = restoreCompactions(dropped, 6, 6);

    expect(restored.map((event) => event.seq)).toEqual([6, 7, 8, 9]);
    expect(restored[0]?.data).toMatchObject({ turn: null });
    expect((restored[2] as unknown as { surfaceOp: unknown }).surfaceOp).toMatchObject({
      op: "replace",
      startSeq: 4,
      endSeq: 5,
    });
  });
});

describe("precedingContentIndex", () => {
  it("跳过没有用户输入 / 助手正文的空回合", () => {
    const events = [
      ...turnLog(0, 1),
      { type: "turn/start", seq: 6, time: 6, data: { turn: 2 } } as unknown as SessionEvent,
      {
        type: "turn/end",
        seq: 7,
        time: 7,
        data: { turn: 2, reason: { kind: "completed" } },
      } as unknown as SessionEvent,
    ];

    expect(precedingContentIndex(closedTurns(events), 1)).toBe(0);
  });
});

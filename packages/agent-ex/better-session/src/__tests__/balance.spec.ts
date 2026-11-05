// 保留前缀的配平不变量：rewind / fork 之后紧接着追加新的 step/start，悬空的旧 step/start 会让它报错。
import { balanceRewindPrefix, rewindKeepLength } from "@morlay/better-session/endpoint";
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { describe, expect, it } from "vitest";

function stepStart(seq: number, turn: number, step: number): SessionEvent {
  return { type: "step/start", seq, time: seq, data: { turn, step } } as unknown as SessionEvent;
}

function stepEnd(seq: number, turn: number, step: number): SessionEvent {
  return { type: "step/end", seq, time: seq, data: { turn, step } } as unknown as SessionEvent;
}

function turnStart(seq: number, turn: number): SessionEvent {
  return { type: "turn/start", seq, time: seq, data: { turn } } as unknown as SessionEvent;
}

function turnEnd(seq: number, turn: number): SessionEvent {
  return {
    type: "turn/end",
    seq,
    time: seq,
    data: { turn, reason: { kind: "completed" } },
  } as unknown as SessionEvent;
}

function seqsOf(events: readonly SessionEvent[]): number[] {
  return events.map((event) => event.seq);
}

describe("balanceRewindPrefix", () => {
  it("丢弃尾部孤立的 step/start，保留它之前的 turn/start", () => {
    const prefix = [
      turnStart(0, 1),
      stepStart(1, 1, 1),
      stepEnd(2, 1, 1),
      turnEnd(3, 1),
      turnStart(4, 2),
      stepStart(5, 2, 1),
    ];

    expect(seqsOf(balanceRewindPrefix(prefix))).toEqual([0, 1, 2, 3, 4]);
  });

  it("已闭合的轮次原样保留", () => {
    const prefix = [turnStart(0, 1), stepStart(1, 1, 1), stepEnd(2, 1, 1), turnEnd(3, 1)];

    expect(seqsOf(balanceRewindPrefix(prefix))).toEqual([0, 1, 2, 3]);
  });

  it("step/end 与未闭合的 step/start 不配对时，从该 step/end 起丢弃尾部（自愈）", () => {
    const prefix = [turnStart(0, 1), stepStart(1, 1, 1), stepEnd(2, 1, 2)];

    expect(seqsOf(balanceRewindPrefix(prefix))).toEqual([0]);
  });

  it("连续的孤立 step/end 从第一个起丢弃", () => {
    const prefix = [turnStart(0, 1), stepEnd(1, 1, 1), stepEnd(2, 1, 1), turnEnd(3, 1)];

    expect(seqsOf(balanceRewindPrefix(prefix))).toEqual([0]);
  });

  it("step/start 撞上未闭合的 step/start 时从后一个起丢弃", () => {
    const prefix = [turnStart(0, 1), stepStart(1, 1, 1), stepStart(2, 1, 2), turnEnd(3, 1)];

    expect(seqsOf(balanceRewindPrefix(prefix))).toEqual([0]);
  });

  it("不修改入参", () => {
    const prefix = [turnStart(0, 1), stepStart(1, 1, 1)];
    const snapshot = [...prefix];

    balanceRewindPrefix(prefix);

    expect(prefix).toEqual(snapshot);
  });

  it("空日志给空前缀", () => {
    expect(balanceRewindPrefix([])).toEqual([]);
  });

  it("keepOpenTail 保留尾部未闭合的 step/start（导出 / 导入的整段日志）", () => {
    const prefix = [turnStart(0, 1), stepStart(1, 1, 1), turnStart(2, 2)];

    expect(seqsOf(balanceRewindPrefix(prefix, { keepOpenTail: true }))).toEqual([0, 1, 2]);
  });

  it("keepOpenTail 仍丢弃不平衡的尾部（不放过错误形状）", () => {
    const prefix = [
      turnStart(0, 1),
      stepStart(1, 1, 1),
      stepEnd(2, 1, 1),
      turnEnd(3, 1),
      turnStart(4, 2),
      stepEnd(5, 2, 1),
    ];

    expect(seqsOf(balanceRewindPrefix(prefix, { keepOpenTail: true }))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("rewindKeepLength", () => {
  it("窗口里没有未闭合的 step/start 时原样返回", () => {
    expect(rewindKeepLength(["turn/start", "step/start", "step/end", "turn/end"], 4)).toBe(4);
  });

  it("尾部未闭合的 step/start 从它起截掉", () => {
    expect(rewindKeepLength(["turn/end", "turn/start", "step/start"], 10)).toBe(9);
  });

  it("遇到 turn/end 即停止往回扫：只修剪最后一个 turn/end 之后的尾部", () => {
    // 尾部那个 step/start 未闭合，从它起截掉；再往前的 turn/end 是扫描的终点，不再往前看。
    expect(rewindKeepLength(["step/start", "turn/end", "step/start"], 3)).toBe(2);
  });
});

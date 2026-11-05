// 会话域的**造数据 fixtures**：一份会话日志的几种常见形状（下游域的 spec 从这里取，别各抄一份）。
//
// 两份「一个闭合回合」是有意并存的，它们的事件顺序相反，各自被不同的断言钉住：
// - `oneTurnLog()`：user/message 在 step/start **之前**（落盘契约与 rdb 系的顺序断言用它）；
// - `oneTurnLogStepFirst()`：`turnLog(0, 1)` 派生，step/start 在 user/message **之前**
//   （端点那一侧用 seq 2 = user/message 定位一条用户消息）。
// 合并任一份都会动到既有断言，所以是两个名字，不要合并。
import { SESSION_FORMAT_VERSION, Session, SessionId, SessionSeq } from "@deepseek-ai/dsh-session";
import type {
  SessionEvent,
  SessionHeader,
  SurfaceEventType,
  SurfaceIntent,
} from "@deepseek-ai/dsh-session";

/**
 * 造一份会话 header。
 * @param id - 会话 id（裸字符串，这里铸成品牌）。
 * @param cwd - 工作目录；省略时不带 `cwd` 字段。
 * @returns 一份当前格式版本的 header。
 */
export function meta(id: string, cwd?: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1000,
    isSeeded: false,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

/**
 * 一条用户消息事件。
 * @param seq - 事件序号。
 * @param id - 消息 id。
 * @param text - 唯一的文本块内容。
 * @param time - 事件时间（默认与 seq 相同）。
 * @returns `user/message` 事件（带 `surfaceOp: "append"`）。
 */
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

/**
 * 一条助手消息事件。
 * @param seq - 事件序号。
 * @param turn - 所属回合。
 * @param step - 所属步骤。
 * @param id - 消息 id。
 * @param text - 唯一的文本块内容。
 * @param time - 事件时间（默认与 seq 相同）。
 * @returns `assistant/message` 事件（带 `surfaceOp: "append"`）。
 */
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
      stream: [],
    },
    surfaceOp: "append",
  } as unknown as SessionEvent;
}

/**
 * 一个完整回合：turn/start → step/start → user/message → assistant/message → step/end → turn/end。
 * @param base - 起始序号。
 * @param turn - 回合号。
 * @param options - `closed` 决定要不要收尾的 turn/end；`users` 是这一步里的用户输入。
 * @returns 事件列表。
 */
export function turnLog(
  base: number,
  turn: number,
  options: { closed?: boolean; users?: readonly { id: string; text: string }[] } = {},
): SessionEvent[] {
  const { closed = true } = options;
  const users = options.users ?? [{ id: `t${turn}-u1`, text: `turn ${turn} input` }];
  const events: SessionEvent[] = [
    {
      type: "turn/start",
      seq: SessionSeq(base),
      time: base,
      data: { turn },
    } as unknown as SessionEvent,
  ];
  let seq = base + 1;
  let step = 1;
  for (const user of users) {
    events.push({
      type: "step/start",
      seq: SessionSeq(seq++),
      time: base,
      data: { turn, step },
    } as unknown as SessionEvent);
    events.push(userMessage(seq++, user.id, user.text, base));
    events.push(
      assistantMessage(seq++, turn, step, `${user.id}-a`, `answer to ${user.text}`, base),
    );
    events.push({
      type: "step/end",
      seq: SessionSeq(seq++),
      time: base,
      data: { turn, step },
    } as unknown as SessionEvent);
    step += 1;
  }
  if (closed) {
    events.push({
      type: "turn/end",
      seq: SessionSeq(seq++),
      time: base,
      data: { turn, reason: { kind: "completed" } },
    } as unknown as SessionEvent);
  }
  return events;
}

/**
 * 一个闭合回合，**user/message 在 step/start 之前**（手写六条，契约套件的形状）。
 * @returns 六条事件（seq 0..5）。
 */
export function oneTurnLog(): SessionEvent[] {
  return [
    { type: "turn/start", seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    {
      type: "user/message",
      seq: SessionSeq(1),
      time: 2,
      data: {
        id: "one-turn-user",
        role: "user",
        content: [{ type: "text", text: "hi" }],
        source: { kind: "user" },
      },
      surfaceOp: "append",
    } as unknown as SessionEvent,
    { type: "step/start", seq: SessionSeq(2), time: 3, data: { turn: 1, step: 1 } },
    {
      type: "assistant/message",
      seq: SessionSeq(3),
      time: 4,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "one-turn-assistant",
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          source: {
            kind: "model",
            provider: "mock",
            model: "mock",
          },
        },
        stream: [
          { type: "chunk", time: 3, chunk: { type: "block-start", index: 0, blockType: "text" } },
          { type: "text-chunks", time0: 3, index: 0, dt: [], texts: ["hello"] },
          {
            type: "chunk",
            time: 4,
            chunk: { type: "block-end", index: 0, block: { type: "text", text: "hello" } },
          },
          { type: "chunk", time: 4, chunk: { type: "finish", reason: { kind: "stop" } } },
        ],
      },
      surfaceOp: "append",
    } as unknown as SessionEvent,
    { type: "step/end", seq: SessionSeq(4), time: 5, data: { turn: 1, step: 1 } },
    {
      type: "turn/end",
      seq: SessionSeq(5),
      time: 6,
      data: { turn: 1, reason: { kind: "completed" } },
    },
  ];
}

/**
 * 一个闭合回合，**step/start 在 user/message 之前**（`turnLog(0, 1)` 的形状）。
 * @returns 六条事件（seq 0..5）。
 */
export function oneTurnLogStepFirst(): SessionEvent[] {
  return turnLog(0, 1);
}

/**
 * 第二个闭合回合，只有起止两条（收尾用的最小形状）。
 * @param startSeq - 起始序号（默认 6，接在 `oneTurnLog` 之后）。
 * @returns 两条事件。
 */
export function secondTurn(startSeq = 6): SessionEvent[] {
  return [
    { type: "turn/start", seq: SessionSeq(startSeq), time: 9, data: { turn: 2 } },
    {
      type: "turn/end",
      seq: SessionSeq(startSeq + 1),
      time: 10,
      data: { turn: 2, reason: { kind: "completed" } },
    },
  ];
}

/**
 * 往一份**活会话**里追加一批事件（保留 `surfaceOp` 与来源序号）。
 * @param session - 目标会话。
 * @param events - 要追加的事件。
 */
export function appendLog(session: Session, events: readonly SessionEvent[]): void {
  for (const e of events) {
    const se = e as SessionEvent<SurfaceEventType>;
    if (se.surfaceOp !== undefined) {
      const intent: SurfaceIntent = {
        surfaceOp: se.surfaceOp,
        ...(se.sourceEventSeqs !== undefined ? { sourceEventSeqs: se.sourceEventSeqs } : {}),
      };
      session.append(e.type, e.data, intent);
    } else {
      session.append(e.type, e.data);
    }
  }
}

/**
 * 两个闭合回合（`turnLog` 的形状，12 条事件）。
 * @returns 事件列表。
 */
export function twoTurnLog(): SessionEvent[] {
  return [...turnLog(0, 1), ...turnLog(6, 2, { users: [{ id: "t2-u1", text: "second turn" }] })];
}

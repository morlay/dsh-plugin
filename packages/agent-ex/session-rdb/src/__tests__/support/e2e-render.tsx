// 全链路用例的渲染面：把**真组件**挂到 happy-dom 上，节点由库里的日志推出。
//
// 不手搓节点形状：`nodeOf` 从真 `user/message` 事件与它所在回合推出 `ChatNodeView` 要的那几个字段，
// 于是「DOM 上看到的那条消息」就是库里的那一条。
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { UserMessageNodeView } from "../../ui/session-editor/user-message.view.tsx";
import type { SessionEditorFace } from "../../ui/session-editor/session-editor.contract.ts";

// 聊天行自己的文案座（上游 `chat` 字典）：本用例不断言它的内容。
const t = ((key: string) => key) as never;

/** 一条消息节点（`conversation.chat.node` 的 keyed 面要的形状）。 */
export interface MessageNode {
  readonly key: string;
  readonly kind: string;
  readonly id: string;
  readonly target: string;
  readonly anchorSeq: number;
  readonly visibility: string;
  readonly location: unknown;
  readonly data: unknown;
}

interface TurnBounds {
  readonly turn: number;
  readonly startSeq: number;
  readonly endSeq?: number;
}

function turnsOf(events: readonly SessionEvent[]): TurnBounds[] {
  const turns: TurnBounds[] = [];
  let open: { turn: number; startSeq: number } | undefined;
  for (const event of events) {
    if (event.type === "turn/start") {
      open = { turn: event.data.turn, startSeq: event.seq as number };
      continue;
    }
    if (event.type === "turn/end" && open !== undefined && event.data.turn === open.turn) {
      turns.push({ ...open, endSeq: event.seq as number });
      open = undefined;
    }
  }
  if (open !== undefined) turns.push(open);
  return turns;
}

/**
 * 从真日志里取一条 `user/message`，拼成渲染面要的节点。
 * @param events - 库里的日志（存储坐标）。
 * @param seq - 目标 `user/message` 的 seq。
 * @returns 节点。
 */
export function nodeOf(events: readonly SessionEvent[], seq: number): MessageNode {
  const index = events.findIndex((event) => (event.seq as number) === seq);
  const event = events[index];
  if (event === undefined || event.type !== "user/message") {
    throw new Error(`seq ${String(seq)} 不是一条 user/message`);
  }
  const bounds = turnsOf(events).find((turn) =>
    turn.endSeq === undefined ? seq > turn.startSeq : seq > turn.startSeq && seq < turn.endSeq,
  );
  return {
    key: `user:${String(seq)}`,
    kind: "user",
    id: String((event.data as { id: string }).id),
    target: "chat",
    anchorSeq: seq,
    visibility: "visible",
    location:
      bounds === undefined
        ? { kind: "session" }
        : {
            kind: "turn",
            turn: {
              turn: bounds.turn,
              status: bounds.endSeq === undefined ? "open" : "closed",
              steps: [{}],
            },
          },
    data: {
      kind: "user",
      seq,
      time: event.time,
      content: (event.data as { content: readonly unknown[] }).content,
      source: (event.data as { source: unknown }).source,
    },
  };
}

/**
 * 渲染一条用户消息行，动作面来自真 store。
 * @param options - 节点与动作面。
 * @returns 卸载函数。
 */
export function renderUserMessage(options: {
  readonly node: MessageNode;
  readonly face: SessionEditorFace;
}): { unmount(): void } {
  const View = UserMessageNodeView as unknown as (props: Record<string, unknown>) => ReactNode;
  const view = render(
    <View
      node={options.node}
      t={t}
      loadImage={() => undefined}
      renderFactorySlot={() => <span data-testid="user-content" />}
      recall={options.face.recall}
      retry={options.face.retry}
      fork={options.face.fork}
      editorT={options.face.editorT}
    />,
  );
  return { unmount: () => view.unmount() };
}

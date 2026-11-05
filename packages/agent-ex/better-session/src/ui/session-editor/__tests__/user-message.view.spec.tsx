// @vitest-environment happy-dom
// 入口门控：编辑（撤回）只要求存在可编辑文本块——轮外消息也能撤回；重试只对已闭合轮次开放。
// 两个入口都先弹确认再把操作交给注入的动作面。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMessageNodeView } from "../user-message.view.tsx";
import { zh } from "../locales.ts";

afterEach(cleanup);

const t = ((key: string) => key) as never;

// 动作行文案来自本包字典（`locales.ts`）：这里给真字典，断言才落得住。
function editorT(key: keyof typeof zh, params?: Record<string, unknown>): string {
  const template = zh[key];
  if (params === undefined) return template;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replace("{" + name + "}", String(value)),
    template,
  );
}

function closedTurn(): unknown {
  return { kind: "turn", turn: { turn: 1, status: "closed", steps: [{}] } };
}

function openTurn(): unknown {
  return { kind: "turn", turn: { turn: 1, status: "open", steps: [{}] } };
}

function nodeOf(options: { content?: readonly unknown[]; location?: unknown; anchorSeq?: number }) {
  return {
    key: "user:4",
    kind: "user",
    id: "user-1",
    target: "chat",
    anchorSeq: options.anchorSeq ?? 4,
    visibility: "visible",
    location: options.location ?? closedTurn(),
    data: {
      kind: "user",
      seq: options.anchorSeq ?? 4,
      time: 4,
      content: options.content ?? [{ type: "text", text: "hello" }],
      source: { kind: "user" },
    },
  };
}

interface Spies {
  recall: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function faces(): Spies {
  return {
    recall: vi.fn(async () => true),
    retry: vi.fn(async () => true),
  };
}

function renderNode(node: unknown, spies: Spies): void {
  // keyed 渲染器的 props 由 slot 面注入：这里只给门控逻辑关心的那几个。
  const View = UserMessageNodeView as unknown as (props: Record<string, unknown>) => ReactNode;
  render(
    <View
      node={node}
      renderFactorySlot={() => <span data-testid="user-content" />}
      loadImage={() => undefined}
      t={t}
      editorT={editorT}
      recall={spies.recall}
      retry={spies.retry}
    />,
  );
}

describe("UserMessageNodeView 的入口门控", () => {
  it("有文本块的 user 消息：确认后把该块交给 recall", () => {
    const spies = faces();
    renderNode(nodeOf({}), spies);

    fireEvent.click(screen.getByLabelText("编辑"));
    expect(spies.recall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("撤回并编辑"));
    expect(spies.recall).toHaveBeenCalledTimes(1);
    expect(spies.recall.mock.calls[0]?.[0]).toMatchObject({
      kind: "user",
      eventSeq: 4,
      blockIndex: 0,
      text: "hello",
      turn: 1,
    });
    expect(spies.retry).not.toHaveBeenCalled();
    // 分叉**不在这条动作行**：它属于回合末尾（上游 `TurnTailNodeView` 的 `onBranch`）。
    // 这一行只有三个按钮：上游内置的「复制」+ 编辑 + 重试——多一个就是又把它塞回来了。
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("无文本块（只有图片）的消息没有编辑入口", () => {
    const spies = faces();
    renderNode(nodeOf({ content: [{ type: "image", attachment: { id: "a" } }] }), spies);
    expect(screen.queryByLabelText("编辑")).toBeNull();
  });

  it("轮外消息（location 无轮次归属）同样可撤回，但不提供重试", () => {
    const spies = faces();
    renderNode(nodeOf({ location: { kind: "session" } }), spies);

    const edit = screen.getByLabelText("编辑");
    expect(screen.queryByLabelText("重试此回合")).toBeNull();

    fireEvent.click(edit);
    fireEvent.click(screen.getByText("撤回并编辑"));
    expect(spies.recall.mock.calls[0]?.[0]).not.toHaveProperty("turn");
  });

  it("重试只对已闭合轮次开放，并带 truncate 级联", () => {
    const closed = faces();
    renderNode(nodeOf({}), closed);
    fireEvent.click(screen.getByLabelText("重试此回合"));
    fireEvent.click(screen.getByText("确认重试"));
    expect(closed.retry).toHaveBeenCalledWith(1, "truncate");

    cleanup();
    const open = faces();
    renderNode(nodeOf({ location: openTurn() }), open);
    expect(screen.queryByLabelText("重试此回合")).toBeNull();
  });

  it("撤回回填带上该消息的全部文本块", () => {
    const spies = faces();
    renderNode(
      nodeOf({
        content: [
          { type: "text", text: "第一块" },
          { type: "text", text: "第二块" },
        ],
      }),
      spies,
    );
    fireEvent.click(screen.getByLabelText("编辑"));
    fireEvent.click(screen.getByText("撤回并编辑"));
    expect(spies.recall.mock.calls[0]?.[1]).toEqual(["第一块", "第二块"]);
  });
});

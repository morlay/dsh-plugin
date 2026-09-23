// @vitest-environment jsdom
// fork 差异点（见本包 .agents/debts/20260917-临时接管上游对话UI的client半.md）：QueueDock 是上游那一版的薄壳复制，
// 唯一行为差异是「编辑 = 撤回该条到输入框」（上游走 inline edit）；呈现与样式（含 0.1.7-alpha.2 的 chat echo 去重）
// 都照上游，所以这里断言的是上游口径 + 那一条偏离。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxState } from "@deepseek-ai/dsh-agent/types";
import type { SessionSnapshot } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ContentBlock } from "@deepseek-ai/dsh-llm/types";
import type { MessageId } from "@deepseek-ai/dsh-llm/brand";
import type { SnapshotSelectorHook } from "@deepseek-ai/dsh-client-ui-slots";
import { zh } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/locales.ts";
import { QueueDock, type QueueDockProps } from "../client/queue/QueueDock.tsx";

afterEach(cleanup);

const TEMPLATES = zh as unknown as Readonly<Record<string, string>>;
const COPY_KEYS: Readonly<Record<string, string>> = {
  copy: "复制",
  copied: "已复制",
  "markdown.footnotes": "脚注",
};

/** 只做 {name} 占位替换的翻译桩；文案模板取自本包 locale。 */
function translate(key: string, params?: Record<string, unknown>): string {
  const template = COPY_KEYS[key] ?? TEMPLATES[key] ?? key;
  if (params === undefined) return template;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

const t = translate as unknown as QueueDockProps["t"];

type QueueRow = InboxState["next-turn"][number];

function row(id: string, content: readonly ContentBlock[], rpcId?: string): QueueRow {
  return {
    id: id as MessageId,
    role: "user",
    content: [...content],
    source:
      rpcId === undefined
        ? { kind: "user" }
        : ({ kind: "user", rpcId } as unknown as QueueRow["source"]),
  } as unknown as QueueRow;
}

function textRow(id: string, text: string, rpcId?: string): QueueRow {
  return row(id, [{ type: "text", text }], rpcId);
}

function sessionOf(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    running: true,
    subagent: null,
    pendingSubmissions: [],
    ...overrides,
  } as unknown as SessionSnapshot;
}

function renderDock(
  snapshot: SessionSnapshot,
  faces: {
    updateQueue?: () => Promise<void>;
    inbox?: InboxState["next-turn"];
  } = {},
): {
  notify: ReturnType<typeof vi.fn>;
  updateQueue: ReturnType<typeof vi.fn>;
  restoreDraft: ReturnType<typeof vi.fn>;
} {
  const notify = vi.fn();
  const restoreDraft = vi.fn();
  const updateQueue = vi.fn(faces.updateQueue ?? (() => Promise.resolve()));
  const inbox: InboxState = {
    "next-turn": faces.inbox ?? [],
    "next-step": [],
  };
  const props = {
    useSession: ((selector: (state: SessionSnapshot) => unknown) =>
      selector(snapshot)) as unknown as SnapshotSelectorHook<SessionSnapshot>,
    useProjection: ((key: string) =>
      key === "inbox" ? inbox : undefined) as unknown as QueueDockProps["useProjection"],
    updateQueue,
    notify,
    loadImage: () => Promise.resolve("blob:image"),
    restoreDraft,
    t,
  };
  render(<QueueDock {...(props as unknown as QueueDockProps)} />);
  return { notify, updateQueue, restoreDraft };
}

function dockText(): string {
  return document.querySelector("[data-queue-dock]")?.textContent ?? "";
}

describe("QueueDock: 队列行的文本（上游口径）", () => {
  it("空队列不渲染 dock", () => {
    renderDock(sessionOf());
    expect(document.querySelector("[data-queue-dock]")).toBeNull();
  });

  it("单行队列直接显示行文本，不带计数头部", () => {
    renderDock(sessionOf(), { inbox: [textRow("q1", "先跑测试")] });
    expect(document.querySelector("[data-queue-dock]")).not.toBeNull();
    expect(screen.getByText("先跑测试")).toBeTruthy();
    expect(screen.queryByText("1 条排队消息")).toBeNull();
  });

  it("展示文本超过 200 字符按上游口径截断", () => {
    renderDock(sessionOf(), { inbox: [textRow("q1", "凑长度".repeat(70))] });
    expect(dockText().endsWith("…")).toBe(true);
  });

  it("图片 / 文件块不占展示文本的位", () => {
    renderDock(sessionOf(), {
      inbox: [row("q1", [{ type: "text", text: "看这个" }, { type: "image" } as ContentBlock])],
    });
    expect(dockText()).toContain("看这个");
    expect(dockText()).not.toContain("[image]");
  });

  it("多段文本压成一行展示（块间一个空格）", () => {
    renderDock(sessionOf(), { inbox: [textRow("q1", "第一段\n\n第二段")] });
    const rows = document.querySelectorAll("[data-queue-dock] li");
    expect(rows).toHaveLength(1);
    expect(dockText()).toContain("第一段 第二段");
  });
});

describe("QueueDock: 与 chat echo 去重", () => {
  // 上游 0.1.7-alpha.2 起：提交落点（placement）在提交时固定，Inbox 收下这条 claim 不会把 chat echo
  // 挪进 dock。所以 dock 自己要把 placement 为 transcript 的提交对应的队列行滤掉，否则同一条消息
  // 既在对话里 echo、又在队列里出现一遍。
  it("placement 为 transcript 的提交对应的队列行不显示", () => {
    renderDock(
      sessionOf({
        pendingSubmissions: [
          { requestId: "r1", placement: "transcript", time: 1 },
        ] as unknown as SessionSnapshot["pendingSubmissions"],
      }),
      { inbox: [textRow("q1", "排队中", "r1")] },
    );
    expect(document.querySelector("[data-queue-dock]")).toBeNull();
  });

  it("同一队列里别的行照常显示", () => {
    renderDock(
      sessionOf({
        pendingSubmissions: [
          { requestId: "r1", placement: "transcript", time: 1 },
        ] as unknown as SessionSnapshot["pendingSubmissions"],
      }),
      { inbox: [textRow("q1", "排队中", "r1"), textRow("q2", "另一条")] },
    );
    expect(dockText()).toContain("另一条");
    expect(dockText()).not.toContain("排队中");
  });
});

describe("QueueDock: 折叠与展开", () => {
  it("多行默认折叠，展开后逐行可见", () => {
    renderDock(sessionOf(), { inbox: [textRow("q1", "第一条"), textRow("q2", "第二条")] });
    const header = screen.getByRole("button", { name: /2 条排队消息/u });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("第一条")).toBeNull();

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("第一条")).toBeTruthy();
    expect(screen.getByText("第二条")).toBeTruthy();
  });
});

describe("QueueDock: 行操作门控", () => {
  it("运行中才可插话发送", () => {
    renderDock(sessionOf({ running: true }), { inbox: [textRow("q1", "排队中")] });
    expect(screen.getByLabelText("插话发送").hasAttribute("disabled")).toBe(false);

    cleanup();
    renderDock(sessionOf({ running: false }), { inbox: [textRow("q1", "排队中")] });
    const steer = screen.getByLabelText("插话发送");
    expect(steer.hasAttribute("disabled")).toBe(true);
    expect(steer.getAttribute("title")).toBe("仅运行中可插话发送");
  });

  it("子代理会话的队列只读时不渲染行操作", () => {
    renderDock(
      sessionOf({
        subagent: { address: { mode: "snapshot" } },
      } as unknown as Partial<SessionSnapshot>),
      { inbox: [textRow("q1", "排队中")] },
    );
    expect(screen.queryByLabelText("删除排队消息")).toBeNull();
    expect(screen.queryByLabelText("编辑排队消息")).toBeNull();
  });

  it("没有文本的行不能编辑，并给出原因", () => {
    renderDock(sessionOf(), {
      inbox: [row("q1", [{ type: "image" } as ContentBlock])],
    });
    const edit = screen.getByLabelText("编辑排队消息");
    expect(edit.hasAttribute("disabled")).toBe(true);
    expect(edit.getAttribute("title")).toBe("包含非文本内容，暂不支持编辑");
  });

  it("删除失败给出错误提示", async () => {
    const { notify } = renderDock(sessionOf(), {
      inbox: [textRow("q1", "排队中")],
      updateQueue: () => Promise.reject(new Error("boom")),
    });
    fireEvent.click(screen.getByLabelText("删除排队消息"));

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith("error", "删除失败：这条消息可能已经开始发送。");
    });
  });

  it("删除成功后调用队列更新并带上 remove 动作", async () => {
    const { updateQueue } = renderDock(sessionOf(), { inbox: [textRow("q1", "排队中")] });
    fireEvent.click(screen.getByLabelText("删除排队消息"));

    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith("q1", { kind: "remove" });
    });
  });
});

describe("QueueDock: 队列行撤回（本包唯一偏离）", () => {
  it("点编辑按钮直接撤回：移除队列项并把文本回填输入框，不进入行内编辑", async () => {
    const { updateQueue, restoreDraft } = renderDock(sessionOf(), {
      inbox: [textRow("q1", "先跑测试")],
    });
    fireEvent.click(screen.getByLabelText("编辑排队消息"));

    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith("q1", { kind: "remove" });
      expect(restoreDraft).toHaveBeenCalledWith("先跑测试");
    });
    // 上游在这条路径上会渲染一个行内 textarea；我们不做行内编辑。
    expect(document.querySelector("[data-queue-dock] textarea")).toBeNull();
  });

  it("撤回的是未截断的原文，而不是展示用的截断文本", async () => {
    const filler = "凑长度".repeat(70);
    const { restoreDraft } = renderDock(sessionOf(), {
      inbox: [
        row("q1", [
          { type: "text", text: filler },
          { type: "text", text: "看 file:src/a.ts#L3-L5" },
        ]),
      ],
    });
    fireEvent.click(screen.getByLabelText("编辑排队消息"));

    await waitFor(() => {
      expect(restoreDraft).toHaveBeenCalledWith(`${filler}看 file:src/a.ts#L3-L5`);
    });
  });

  it("撤回失败：不回填输入框，并给出错误提示", async () => {
    const { notify, restoreDraft } = renderDock(sessionOf(), {
      inbox: [textRow("q1", "先跑测试")],
      updateQueue: () => Promise.reject(new Error("boom")),
    });
    fireEvent.click(screen.getByLabelText("编辑排队消息"));

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith("error", "删除失败：这条消息可能已经开始发送。");
    });
    expect(restoreDraft).not.toHaveBeenCalled();
  });
});

describe("QueueDock: 本地提交回显", () => {
  it("尚未被队列接纳的本地提交显示发送中状态", () => {
    renderDock(
      sessionOf({
        pendingSubmissions: [
          { requestId: "r1", placement: "queued", text: "第二条", attachments: [] },
        ],
      } as unknown as Partial<SessionSnapshot>),
    );
    const dock = document.querySelector("[data-queue-dock]");
    expect(dock?.querySelector("[data-submission-echo]")?.textContent).toContain("第二条");
    expect(dock?.textContent).toContain("发送中…");
  });

  it("队列已接纳的本地提交不再重复显示", () => {
    renderDock(
      sessionOf({
        pendingSubmissions: [
          { requestId: "r1", placement: "queued", text: "第一条", attachments: [] },
        ],
      } as unknown as Partial<SessionSnapshot>),
      { inbox: [textRow("q1", "第一条", "r1")] },
    );
    expect(document.querySelector("[data-submission-echo]")).toBeNull();
    expect(document.querySelector("[data-queue-dock]")?.textContent).not.toContain("发送中…");
  });
});

// @vitest-environment jsdom
// fork 差异点（见本包 .agents/debts/20260917-临时接管上游对话UI的client半.md）：scoped slash 事件归一（引用落裸 URI 纯文本、skill 落
// skill: token）+ 会话 cwd 注入到工作区相对化。
import { Context } from "@deepseek-ai/cordis";
import type { InboxState } from "@deepseek-ai/dsh-agent/types";
import type {
  ISessions,
  SessionBinding,
  SessionFace,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { TranslateNS } from "@deepseek-ai/dsh-client-locale/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferenceInsert } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/draft-editor.ts";
import type { SessionInputShell } from "../client/input/facade.ts";
import { InputHub } from "../client/input/hub.ts";

const SID = "s1" as SessionId;
const CWD = "/w/proj";

const FILE_INSERT: ReferenceInsert = {
  source: "reference",
  ref: "@src/a.ts",
  label: "a.ts",
  appearance: "file",
  clipboardText: "@src/a.ts",
};

const t = ((key: string) => key) as unknown as TranslateNS<"conversation">;

interface Bench {
  hub: InputHub;
  actx: Context;
  shell: SessionInputShell;
  session: { updateQueue: ReturnType<typeof vi.fn> };
  emit: (name: string, payload: unknown) => void;
}

const disposed: (() => void)[] = [];

function queuedRow(id: string): InboxState["next-turn"][number] {
  return {
    id,
    role: "user",
    content: [{ type: "text", text: "排队中" }],
    source: { kind: "user" },
  } as unknown as InboxState["next-turn"][number];
}

function bench(
  options: {
    queue?: InboxState["next-turn"];
    sessionState?: Record<string, unknown>;
    projections?: Record<string, unknown>;
    analytics?: { track: ReturnType<typeof vi.fn> };
  } = {},
): Bench {
  const session = {
    updateQueue: vi.fn(async () => ({ ok: true })),
  };
  const inbox: InboxState = { "next-turn": options.queue ?? [], "next-step": [] };
  const face = {
    getSnapshot: () => options.sessionState ?? {},
    subscribe: () => () => {},
    projections: {
      faceOf: (key: string) =>
        key === "inbox"
          ? { getSnapshot: () => inbox, subscribe: () => () => {} }
          : { getSnapshot: () => options.projections?.[key], subscribe: () => () => {} },
    },
    updateQueue: session.updateQueue,
    readAttachment: async () => ({ ok: false }),
  } as unknown as SessionFace;
  const actx = new Context();
  const binding: SessionBinding = {
    sessionId: SID,
    session: face,
    eventSource: {
      getSnapshot: () => ({
        entries: [],
        hasMore: false,
        revision: 0,
        change: { kind: "replace", entries: [] },
      }),
      subscribe: () => () => {},
    },
    ctx: actx as SessionBinding["ctx"],
  };
  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: [SID],
        byId: { [SID]: { cwd: CWD } },
        phase: "ready",
        subagentsByParent: {},
        jobsBySession: {},
      }),
      subscribe: () => () => {},
    },
    sessionOf: (ctx: Context) => (ctx === actx ? face : undefined),
    binding: (id: SessionId) => (id === SID ? binding : undefined),
  } as unknown as ISessions;
  const rootCtx = new Context();
  rootCtx.provide("sessions", sessions);
  rootCtx.provide("conversation", {
    serializeDraftAttachments: async () => ({ attachments: [] }),
    releaseDraftAttachment: () => {},
    sendSession: async () => ({ kind: "success" }),
  });
  if (options.analytics !== undefined) rootCtx.provide("productAnalytics", options.analytics);
  const hub = new InputHub(rootCtx, t);
  const shell = hub.shellFor(binding);
  disposed.push(() => {
    shell.dispose();
    void rootCtx.fiber.dispose();
    void actx.fiber.dispose();
  });
  return {
    hub,
    actx,
    shell,
    session,
    emit: (name, payload) => {
      (actx as unknown as { emit: (event: string, input: unknown) => unknown }).emit(name, payload);
    },
  };
}

function spanOf(shell: SessionInputShell, end = shell.snapshot.draft.length) {
  return { start: 0, end, draftRev: shell.snapshot.draftRev };
}

afterEach(() => {
  for (const dispose of disposed.splice(0)) dispose();
});

describe("InputHub: scoped slash 事件归一", () => {
  it("插入引用事件把 pick 的引用原文落成纯文本", () => {
    const { shell, emit } = bench();
    shell.setDraft("@src/");
    emit("slash/input-insert-reference", { reference: FILE_INSERT, span: spanOf(shell, 5) });

    expect(shell.snapshot.draft).toBe("@src/a.ts ");
    expect(shell.snapshot.occurrences).toEqual([]);
  });

  it("插入文本事件把 skill 令牌落成 skill: token", () => {
    const { shell, emit } = bench();
    shell.setDraft("/code-review");
    emit("slash/input-insert-text", { text: "/code-review ", span: spanOf(shell, 12) });

    expect(shell.snapshot.draft).toBe("skill:code-review ");
  });

  it("消费令牌事件按 bare-token guard 清空草稿", () => {
    const { shell, emit } = bench();
    shell.setDraft("/goal");
    emit("slash/input-consume-token", { guard: { kind: "bare-token", token: "/goal" } });

    expect(shell.snapshot.draft).toBe("");
  });
});

describe("InputHub: 会话 shell 复用与寻址", () => {
  it("同一会话复用同一个 shell 实例", () => {
    const { hub, shell } = bench();
    expect(hub.shell(SID)).toBe(shell);
    expect(hub.keyboard(SID)).toBe(shell);
  });

  it("未知会话寻址失败", () => {
    const { hub } = bench();
    expect(() => hub.shell("nope" as SessionId)).toThrow(/nope/u);
  });
});

describe("InputHub: 消息提交埋点", () => {
  const SESSION_STATE = { blank: false, sessionId: SID, running: false };

  function benchWithAnalytics(
    overrides: {
      sessionState?: Record<string, unknown>;
      planActive?: boolean;
      goalActive?: boolean;
    } = {},
  ) {
    const track = vi.fn();
    const created = bench({
      sessionState: overrides.sessionState ?? SESSION_STATE,
      projections: {
        modelSelection: {
          next: { provider: "deepseek", model: "chat", reasoningEffort: "high" },
        },
        plan: { active: overrides.planActive ?? false },
        goal: { goal: { phase: overrides.goalActive === true ? "active" : "done" } },
      },
      analytics: { track },
    });
    return { ...created, track };
  }

  it("提交把会话快照投成 send_button_click 事件", async () => {
    const { shell, track } = benchWithAnalytics({ planActive: true });
    shell.setDraft("hello");
    shell.submit("queue", "enter");

    await vi.waitFor(() => {
      expect(track).toHaveBeenCalledTimes(1);
    });
    const [name, attributes, timestamp] = track.mock.calls[0] ?? [];
    expect(name).toBe("send_button_click");
    expect(attributes).toEqual({
      session_id: SID,
      model_name: "deepseek/chat",
      thinking_effort: "high",
      run_mode: "plan",
      msg_type: "default",
    });
    expect(typeof timestamp).toBe("number");
  });

  it("运行中的提交按 mode 标记 msg_type，plan 未激活时回落 default", async () => {
    const { shell, track } = benchWithAnalytics({
      sessionState: { ...SESSION_STATE, running: true },
    });
    shell.setDraft("插一句");
    shell.submit("steer", "click");

    await vi.waitFor(() => {
      expect(track).toHaveBeenCalledTimes(1);
    });
    expect(track.mock.calls[0]?.[1]).toMatchObject({ run_mode: "default", msg_type: "steer" });
  });

  it("goal 投影激活时 run_mode 记 goal", async () => {
    const { shell, track } = benchWithAnalytics({ goalActive: true });
    shell.setDraft("hello");
    shell.submit("queue");

    await vi.waitFor(() => {
      expect(track).toHaveBeenCalledTimes(1);
    });
    expect(track.mock.calls[0]?.[1]).toMatchObject({ run_mode: "goal" });
  });

  it("没有 productAnalytics 服务时提交照常", async () => {
    const { shell } = bench();
    shell.setDraft("hello");
    shell.submit("queue");

    await vi.waitFor(() => {
      expect(shell.snapshot.draft).toBe("");
    });
  });
});

describe("InputHub: 队列插话", () => {
  it("把 inbox next-turn 里的行逐条交给会话的 steer 动作", async () => {
    const { shell, session } = bench({ queue: [queuedRow("q1")] });
    shell.steerQueue();

    await vi.waitFor(() => {
      expect(session.updateQueue).toHaveBeenCalledWith("q1", { kind: "steer" });
    });
  });

  it("插话不可用时静默返回，不产生错误提示", async () => {
    const { shell, session } = bench({ queue: [queuedRow("q1")] });
    session.updateQueue.mockResolvedValue({
      ok: false,
      error: { code: "session/steer-unavailable", message: "busy" },
    });
    shell.steerQueue();

    await vi.waitFor(() => {
      expect(session.updateQueue).toHaveBeenCalledTimes(1);
    });
    expect(shell.notices.getSnapshot()).toBeNull();
  });

  it("其它失败原因给出错误提示", async () => {
    const { shell, session } = bench({ queue: [queuedRow("q1")] });
    session.updateQueue.mockResolvedValue({
      ok: false,
      error: { code: "session/transport", message: "boom" },
    });
    shell.steerQueue();

    await vi.waitFor(() => {
      expect(shell.notices.getSnapshot()).toMatchObject({ level: "error" });
    });
  });
});

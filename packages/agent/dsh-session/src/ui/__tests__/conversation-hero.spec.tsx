// @vitest-environment happy-dom
/**
 * 空白会话的主区形态：`ui-conversation` 的 hero（居中输入）vs 底部常驻输入栏。
 *
 * 判据在上游 `ConversationMainPanel` 里：`hero = sessionId === undefined
 * || (conversationPhase(session, conversation) === 'blank' && (openState === 'open'
 * || summaryBlank === true))`，其中 `session` 来自我们 `SessionController.binding()` 的
 * `SessionSnapshot`。这一层装配的是**真**上游面板 + **真** `SessionControllerDefault`，
 * 只替传输层（`FakeRemote` 给 wire 行），所以失败点就落在「我们给上游的快照对不对」上。
 */
import { ConversationContent } from "@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationContent.tsx";
import { ConversationMainPanel } from "@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationMainPanel.tsx";
import { EMPTY_CONVERSATION_SNAPSHOT } from "@deepseek-ai/dsh-client-ui-conversation/src/client/contract/snapshot.ts";
import type {
  ConversationContentProps,
  ConversationSlotProps,
} from "@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts";
import { bootstrapApplication } from "@morlay/zephyr";
import { mockTransport, SessionRemoteDefault } from "@morlay/zephyr-app/client";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SessionController, type SessionCatalogState } from "../session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";
import { FakeRemote } from "./support/fake-remote.ts";

/** 一行宿主的会话摘要（`session/list` 的 byId 形状）。 */
function summaryOf(id: string, blank: boolean): Record<string, unknown> {
  return {
    id,
    sessionId: id,
    title: `会话 ${id}`,
    cwd: "/tmp/w",
    blank,
    running: false,
    agentAvailable: true,
    updatedAt: 1,
    retainedBy: {},
  };
}

/**
 * 起真 store + 假传输，并把目录预置成一行。
 * @param blank - 该行在 wire 上的 `blank`（空白会话为 true）。
 * @returns 应用、契约实例。
 */
async function boot(
  blank: boolean,
): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>>; sessions: SessionController }> {
  FakeRemote.next = {
    handlers: {
      "session/list": () => ({ ids: ["s1"], byId: { s1: summaryOf("s1", blank) } }),
      // 宿主收下 prompt（`RemoteResultWire` 的成功形态）。
      "session/prompt": () => ({ ok: true }),
    },
    streams: { "session/follow": async function* () {} } as Parameters<typeof mockTransport>[1],
  };
  const app = await bootstrapApplication({
    providers: [...provideSessionsStore(),
    FakeRemote, SessionRemoteDefault],
    timeoutMs: 8_000,
  });
  return { app, sessions: app.get(SessionController) };
}

/** 上游面板真正读到的两个席位：`conversation.composer.bar` 的 props 与 factory 的入参。 */
interface Captured {
  readonly composerBar: { variant?: string }[];
  readonly content: { hero?: boolean; phase?: string }[];
}

/**
 * 用真 store 的数据面装出上游面板，记录它交给席位的东西。
 * @param sessions - 真 `SessionController`。
 * @param captured - 记录器。
 * @returns 渲染结果。
 */
function renderPanel(sessions: SessionController, captured: Captured): ReturnType<typeof render> {
  const list = sessions.list.getSnapshot() as SessionCatalogState;
  const sessionId = list.ids[0];
  const binding = sessionId === undefined ? undefined : sessions.binding(sessionId);
  const session = binding as { session?: { getSnapshot(): unknown } } | undefined;

  // 上游 `useSession` / `useSessions` / `useConversation` 都是 snapshot selector hook：
  // 数据源分别是 binding 的会话快照、目录快照与 Conversation 快照（没有 active target）。
  const useSession = (selector: (snapshot: unknown) => unknown) =>
    selector(session?.session?.getSnapshot());
  const useSessions = (selector: (snapshot: unknown) => unknown) => selector(list);
  const useConversation = (selector: (snapshot: unknown) => unknown) =>
    selector(EMPTY_CONVERSATION_SNAPSHOT);

  const renderSlot = (name: string, slotProps: unknown, options?: { fallback?: ReactNode }) => {
    if (name === "conversation.composer.bar")
      captured.composerBar.push(slotProps as { variant?: string });
    return options?.fallback ?? null;
  };
  // 本装配没有 `conversation.composer` 链上的接管者（取景器 / 审批面板），所以链渲染的就是 fallback ——
  // 那个 fallback 里才有 `conversation.composer.bar` 这一次 renderSlot 调用。
  const renderSlotChain = (
    _name: string,
    _chainProps: unknown,
    options?: { fallback?: ReactNode; fallbackOnly?: boolean },
  ) => options?.fallback ?? null;

  // `conversation.content` 的 standard props：只有 hero / active 两条布局分支用到的那几个。
  const contentProps = {
    sessionId,
    useSession,
    useSessions,
    useSessionStatus: (selector: (snapshot: Map<string, unknown>) => unknown) =>
      selector(new Map()),
    useWorkspaces: (selector: (snapshot: unknown) => unknown) =>
      selector({ phase: "ready", items: [] }),
    useInput: (selector: (snapshot: unknown) => unknown) =>
      selector({ text: "", attachmentIds: [] }),
    useComposerBlock: (selector: (block: unknown) => unknown) => selector(undefined),
    renderSlot,
    renderSlotChain,
    selectWorkspace: async () => {},
    t: (key: string) => key,
    // factory 的本地实现（views）由运行时注入 standard props；这里只补它用到的 `renderSlot`。
    useFactorySlot:
      (_slot: string, fallback: (localProps: Record<string, unknown>) => ReactNode) =>
      (localProps: Record<string, unknown>) =>
        fallback({ renderSlot, ...localProps }),
  };

  const props = {
    sessionId,
    useSession,
    useSessions,
    useConversation,
    renderSlot,
    renderSlotChain,
    // factory 的那一次渲染要落到真 `ConversationContent`：`variant` 是它在 hero 分支上决定的。
    renderFactorySlot: (name: string, input: unknown) => {
      if (name !== "conversation.content") return null;
      const content = input as { hero?: boolean; phase?: string };
      captured.content.push(content);
      const panelInput = { ...contentProps, ...content } as unknown as ConversationContentProps;
      return <ConversationContent {...panelInput} />;
    },
  } as unknown as ConversationSlotProps;

  return render(<ConversationMainPanel {...props} />);
}

describe("空白会话的主区形态（hero vs 底部输入栏）", { timeout: 10_000 }, () => {
  it("wire 行 blank=true 的会话渲染成 hero：居中输入（variant='hero'）", async () => {
    const { app, sessions } = await boot(true);
    try {
      const captured: Captured = { composerBar: [], content: [] };
      const view = renderPanel(sessions, captured);

      expect(captured.content[0]?.hero, "空白会话应走 hero 形态").toBe(true);
      expect(captured.content[0]?.phase).toBe("hero");
      expect(captured.composerBar[0]?.variant, "空白会话的输入框是居中 hero").toBe("hero");
      view.unmount();
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("有消息的会话（行 blank=false）仍是底部常驻输入栏（variant='composer'）", async () => {
    const { app, sessions } = await boot(false);
    try {
      const captured: Captured = { composerBar: [], content: [] };
      const view = renderPanel(sessions, captured);

      expect(captured.content[0]?.hero).toBe(false);
      expect(captured.content[0]?.phase).toBe("active");
      expect(captured.composerBar[0]?.variant).toBe("composer");
      view.unmount();
    } finally {
      await app.dispose().catch(() => {});
    }
  });
  it("空白会话发出第一条 prompt 被收下后，立刻切到常驻输入栏（不再居中）", async () => {
    const { app, sessions } = await boot(true);
    try {
      const binding = sessions.binding("s1") as
        | { session: { prompt(content: unknown[], mode: "queue"): Promise<unknown> } }
        | undefined;
      expect(binding).toBeDefined();
      // 行在 wire 上仍是 blank=true（宿主还没回推新行）：本端首发就必须把它翻成「非空白」，
      // 否则 hero 会把刚发过消息的会话继续居中。
      await binding?.session.prompt([], "queue");

      const captured: Captured = { composerBar: [], content: [] };
      const view = renderPanel(sessions, captured);
      expect(captured.content[0]?.hero).toBe(false);
      expect(captured.composerBar[0]?.variant).toBe("composer");
      view.unmount();
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});

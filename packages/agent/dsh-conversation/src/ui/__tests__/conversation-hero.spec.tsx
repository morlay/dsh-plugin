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
  ConversationContentInputProps,
  ConversationContentProps,
  ConversationSlotProps,
} from "@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts";
import type { ComposerBlock } from "@deepseek-ai/dsh-client-ui-conversation/src/client/contract/composer-blocks.ts";
import { bootstrapApplication } from "@morlay/zephyr";
import { mockTransport, SessionRemoteDefault } from "@morlay/zephyr-app/client";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SessionController, type SessionCatalogState } from "@morlay/dsh-conversation/contract";
import type { SessionId } from "@morlay/dsh-session/contract";
import { provideSessionsStore } from "../sessions.provide.ts";
import { FakeRemote } from "./support/fake-remote.ts";

/**
 * 把一份现成快照包成席位要的 selector hook：本用例的数据源不变，selector 立即求值。
 * 席位是泛型签名（`<S>(sel: (s: T) => S, eq?) => S`），桩按席位类型断言一次（不是 `as unknown as` 双断言）。
 * @param value - 该席位读的快照。
 * @returns 符合该席位签名的 hook。
 */
function fixedHook<H>(value: unknown): H {
  return ((selector: (snapshot: unknown) => unknown) => selector(value)) as H;
}

/**
 * 把手写的席位桩收成完整席位：上游每版都在加全局席位，桩只提供本用例真的会读的那几个。
 * 参数类型 `Partial<…>` 就是那道检查（写错名字 / 类型不对会红），缺的席位按"未提供"放过。
 * @param props - 本用例提供的席位。
 * @returns 同名的完整席位对象。
 */
function contentPropsOf(props: Partial<ConversationContentProps>): ConversationContentProps {
  return props as ConversationContentProps;
}

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
      // 上游 `session/list` 的响应是 `{ items }`（每项带 `sessionId`）。
      "session/list": () => ({ items: [{ sessionId: "s1", ...summaryOf("s1", blank) }] }),
      // 宿主收下 prompt（`RemoteResultWire` 的成功形态）。
      "session/prompt": () => ({ ok: true }),
    },
    streams: { "session/follow": async function* () {} } as Parameters<typeof mockTransport>[1],
  };
  const app = await bootstrapApplication({
    providers: [...provideSessionsStore(), FakeRemote, SessionRemoteDefault],
    timeoutMs: 8_000,
  });
  const sessions = app.get(SessionController);
  // 装配时的那次目录拉取是 fire-and-forget：先等它落地，否则下面的 `ids[0]` 是空的（也就 retain 不到）。
  await sessions.refresh();
  // 上游 `ClientSessions.binding(id)` 读的是**已物化的 scope**（`scopes.get(id)?.binding`）：
  // 目录里有行还不够，要先 `retain` 一次才会建 scope。`ui-session` 的 `publishMain` 正是这么做的。
  const sessionId = (sessions.list.getSnapshot() as SessionCatalogState).ids[0];
  if (sessionId !== undefined) sessions.retain(sessionId as never, { source: "gateway" });
  return { app, sessions };
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
  // 三个 selector hook 按席位给：数据源是现成的快照，selector 立即求值。
  const useSession = fixedHook<ConversationContentProps["useSession"]>(
    session?.session?.getSnapshot(),
  );
  const useSessions = fixedHook<ConversationContentProps["useSessions"]>(list);
  const useConversation = fixedHook<ConversationContentProps["useConversation"]>(
    EMPTY_CONVERSATION_SNAPSHOT,
  );

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

  // `conversation.content` 的 standard props：只给 hero / active 两条布局分支真的会读的那几个席位——
  // 上游每版都在加全局席位（0.2.3 加了 `useResource` / `useRemoteAccess` / `SessionProvider` …），
  // 桩不跟着列全（`contentPropsOf` 的 `Partial` 参数就是那道类型检查）。
  // factory 的入参（`hero` / `phase` / `onWorkspaceSelected` …）由上游运行时给，见下面的 spread。
  const contentProps = contentPropsOf({
    // 席位要的是品牌化的会话 id（目录快照给的是裸字符串）。
    sessionId: sessionId as SessionId | undefined,
    useSession,
    useSessions,
    useConversation,
    useSessionStatus: fixedHook<ConversationContentProps["useSessionStatus"]>(new Map()),
    useWorkspaces: fixedHook<ConversationContentProps["useWorkspaces"]>({
      phase: "ready",
      items: [],
    }),
    useInput: fixedHook<ConversationContentProps["useInput"]>({ text: "", attachmentIds: [] }),
    // 席位签名是 `SnapshotSelectorHook<ComposerBlock | undefined>`：本装配没有块来源，恒读 `undefined`。
    useComposerBlock: <T,>(selector: (block: ComposerBlock | undefined) => T): T =>
      selector(undefined),
    // session-maybe 的标准席位：没有当前会话时它也是 `undefined`。
    inputActions: undefined,
    // 0.2.3 新增的 session 作用域席位（renderer 注入）：这里直接透传，等于继承外层 binding。
    SessionProvider: ({ children }: { children: ReactNode }) => children,
    // ui-session 合并进来的两个标准席位（0.2.3）：本用例不读投影、也不做端点授权判断。
    useProjection: () => undefined,
    useAccess: () => undefined,
    // 0.2.3 新增的注入回调：把这一处的草稿移到另一个会话（本用例不切会话）。
    moveDraft: () => {},
    // 这条 content 自己没有 local 席位要选，Factory 槽位一律不渲染。
    renderFactorySlot: () => null,
    // 全局标准席位里本用例用不到的：给"没有值 / 一律允许"的桩。
    useResource: fixedHook<ConversationContentProps["useResource"]>(undefined),
    useRemoteAccess: fixedHook<ConversationContentProps["useRemoteAccess"]>(false),
    useSessionRetainInfo: fixedHook<ConversationContentProps["useSessionRetainInfo"]>(undefined),
    useSessionAccess: () => false,
    usePanelInfo: fixedHook<ConversationContentProps["usePanelInfo"]>(undefined),
    useWorkspaceAccess: () => false,
    renderSlot,
    renderSlotChain,
    t: (key: string) => key,
    // factory 的本地实现（views）由运行时注入 standard props；这里只补它用到的 `renderSlot`。
    useFactorySlot: ((
      _slot: string,
      fallback: (localProps: Record<string, unknown>) => ReactNode,
    ) =>
      (localProps: Record<string, unknown>) =>
        fallback({ renderSlot, ...localProps })) as ConversationContentProps["useFactorySlot"],
  });

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
      // 上游给 factory 的入参就是 `ConversationContentInputProps`（0.2.3 起含 `onWorkspaceSelected`）。
      const content = input as ConversationContentInputProps;
      captured.content.push(content);
      const panelInput: ConversationContentProps = { ...contentProps, ...content };
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

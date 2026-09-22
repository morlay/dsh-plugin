import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { ISessions, SessionBinding } from "@deepseek-ai/dsh-api-session-controller/client";
import { IconPaperclipOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { createSnapshotStore, type BoundActions } from "@deepseek-ai/dsh-client-store";
import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session/types";

import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { UiConversation } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/conversation/assembly.ts";
import type { ViewTab } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/views.ts";
import type {
  ComposerBarInjected,
  ConversationInjected,
  ConversationSessionHeaderInjected,
  ConversationSessionInjected,
  DraftFileUploads,
} from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts";
import type { InputNotice } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/input.ts";
import {
  createConversationStore,
  readConversationViewPreference,
} from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/stores.ts";
import {
  ConversationController,
  UnsupportedImageMediaTypeError,
} from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/service.ts";
import type { IConversation } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/service.ts";
import { ComposerBlockRegistry } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/blocks.ts";
import type { ComposerBlock } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/composer-blocks.ts";
import { InputHub } from "./input/hub.ts";
import { ComposerSubmissionPolicy } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/submission-policy.ts";
import { queueDockEntry } from "./queue/QueueDock.tsx";
import { EnterBehaviorRow } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx";
import type { EnterBehaviorRowInjected } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx";
import { ConversationHeader } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationHeader.tsx";
import { ConversationRoot } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx";
import { ConversationContent } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx";
import { ConversationPanel } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationPanel.tsx";
import {
  ConversationSession,
  ConversationSessionHeader,
} from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx";
import { InputBar } from "./skeleton/InputBar.tsx";
import { todoDockEntry } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx";
import {
  DEVELOPER_TOOLS_VIEW_ID,
  resolveActiveView,
} from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/view-selection.ts";
import {
  en,
  NS,
  zh,
  type ConversationKey,
} from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/locales.ts";
import {
  CONVERSATION_SETTINGS_NAMESPACE,
  type ConversationSettings,
} from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/submission-settings.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    conversation: ConversationKey;
  }
}

export const inject = [
  "slots",
  "sessions",
  "fileUpload",
  "uiSession",
  "uiWorkspace",
  "locale",
  "configForms",
];

export interface Config {
  maxConcurrentFileUploads?: number;
}

export const Config: z<Config> = z.object({
  maxConcurrentFileUploads: z.natural().min(1).default(2),
});

const ABSENT_NOTICES = {
  getSnapshot: (): InputNotice | null => null,
  subscribe: () => () => {},
};
const ABSENT_BLOCK = {
  getSnapshot: (): ComposerBlock | undefined => undefined,
  subscribe: () => () => {},
};
const EMPTY_LEXICON: ReadonlyMap<"/" | "@", readonly string[]> = new Map();
const ABSENT_LEXICON = {
  getSnapshot: () => EMPTY_LEXICON,
  subscribe: () => () => {},
};
const ABSENT_MENU_LAUNCHER = {
  getSnapshot: (): string | null => null,
  subscribe: () => () => {},
};
const EMPTY_FILE_UPLOADS: DraftFileUploads = {};
const ABSENT_FILE_UPLOADS = {
  getSnapshot: () => EMPTY_FILE_UPLOADS,
  subscribe: () => () => {},
};

interface WorkspaceNavigation {
  openSession(sessionId: SessionId): void;
  openWorkspace(
    workspaceId: Parameters<ConversationInjected["selectWorkspace"]>[0],
    beforeOpen: (sessionId: SessionId) => void,
  ): Promise<void>;
}

interface FileCommandRegistry {
  register(contribution: {
    name: string;
    label(): string;
    icon: typeof IconPaperclipOutlineRegular;
    available(session: { sessionId: SessionId }): boolean;
    ui: { kind: "action"; run(session: { sessionId: SessionId }): void };
  }): () => void;
}

function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id);
  if (scoped === undefined) throw new Error(`ui-conversation: session "${id}" resolved no scope`);
  const conversation = scoped.get("conversation");
  if (conversation === undefined) {
    throw new Error("ui-conversation: conversation service unavailable through the session scope");
  }
  return conversation;
}

function concreteConversation(ctx: Context): ConversationController {
  const conversation = ctx.get("conversation") as ConversationController | undefined;
  if (conversation === undefined)
    throw new Error("ui-conversation: conversation service unavailable");
  return conversation;
}

export function apply(ctx: Context, config: Config = Config({})): void {
  const sessions = ctx.sessions as unknown as ISessions;
  const slots = ctx.slots;

  const maxConcurrentFileUploads = config.maxConcurrentFileUploads as number;
  const workspaceNavigation = ctx.get("uiWorkspace") as unknown as WorkspaceNavigation;
  const uiConversation = new UiConversation(ctx, sessions);

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-conversation: dictionaries");
  const t = ctx.locale.bind(NS);
  const conversationStore = createConversationStore();
  const submissionPolicy = new ComposerSubmissionPolicy(
    ctx.configForms.get<ConversationSettings>(CONVERSATION_SETTINGS_NAMESPACE),
  );

  ctx.slots.inject("settings.general.item", () =>
    ctx.slots.register(
      {
        name: "settings.general.item",
        id: "composer-enter",
        order: 20,
        locale: NS,
        inject: (): EnterBehaviorRowInjected => ({
          hooks: { busyEnter: submissionPolicy.busyEnter },
          setBusyEnter: (behavior) => {
            submissionPolicy.setBusyEnter(behavior);
          },
        }),
      },
      EnterBehaviorRow,
    ),
  );

  const viewTabs = (): ViewTab[] => {
    const tabs: ViewTab[] = [];
    for (const entry of slots.entries("conversation.view")) {
      if (entry.options.id === undefined) continue;
      // 开发者工具视图由设置项决定是否出现（上游 0.1.7 起的 `configForms.developerTools`）。
      if (
        !ctx.configForms.developerTools.enabled.getSnapshot() &&
        entry.options.id === DEVELOPER_TOOLS_VIEW_ID
      )
        continue;
      tabs.push({
        id: entry.options.id,
        label: resolveSlotLabel(entry.options.label) ?? entry.options.id,
      });
    }
    return tabs;
  };
  const activateView = (sessionId: SessionId, preferred: string | null): void => {
    const active = resolveActiveView(viewTabs(), preferred);
    if (active !== undefined) uiConversation.binding(sessionId).activate(active.id);
  };
  const restoreView = (sessionId: SessionId): void => {
    activateView(sessionId, readConversationViewPreference(sessionId));
  };
  const conversationViews = createSnapshotStore<readonly ViewTab[]>(viewTabs());
  // 保留模型换代后没有"当前会话"这个中心：谁被借出过（谁挂载过），谁就需要跟着
  // View 名单刷新自己选中的 View。身份是 SessionBinding，借出结束时撤销登记。
  const bindings = new Set<SessionBinding>();
  const trackedBindings = new WeakSet<SessionBinding>();
  const trackBinding = (binding: SessionBinding): void => {
    if (trackedBindings.has(binding)) return;
    trackedBindings.add(binding);
    bindings.add(binding);
    binding.ctx.effect(
      () => () => {
        bindings.delete(binding);
      },
      "ui-conversation: active Provider binding",
    );
  };
  const refreshViews = (): void => {
    const current = conversationViews.getSnapshot();
    const next = viewTabs();
    const unchanged =
      current.length === next.length &&
      current.every((tab, index) => {
        const candidate = next.at(index);
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label;
      });
    if (!unchanged) conversationViews.set(next);
    for (const binding of bindings) restoreView(binding.sessionId);
  };
  ctx.effect(() => {
    const disposeViews = slots.subscribe("conversation.view", refreshViews);
    const disposeLocale = ctx.locale.subscribe(refreshViews);
    // 开发者工具开关是 host 侧的配置（`configForms.developerTools`）：它的快照晚于本装配到达，
    // 且到达后还会被用户改，所以名单必须跟着它重算——否则轨迹 view 一旦在初始 false 时被滤掉，
    // 就再也不出现（上游同款订阅见 vendor 包 apply.ts）。
    const disposeDeveloperTools = ctx.configForms.developerTools.enabled.subscribe(refreshViews);
    return () => {
      disposeDeveloperTools();
      disposeLocale();
      disposeViews();
    };
  }, "ui-conversation: View selection");

  const inputHub = new InputHub(ctx, t);
  const composerBlocks = new ComposerBlockRegistry();

  ctx.inject(["commandUi"], (scope) => {
    const commands = scope.get("commandUi") as FileCommandRegistry;
    scope.effect(
      () =>
        commands.register({
          name: "file",
          label: () => t("input.file"),
          icon: IconPaperclipOutlineRegular,
          available: (session) => inputHub.canPickFiles(session.sessionId),
          ui: {
            kind: "action",
            run: (session) => {
              inputHub.pickFiles(session.sessionId);
            },
          },
        }),
      "ui-conversation: File action",
    );
  });

  ctx.uiSession.provide({
    hooks: ["conversation", "input"],
    props: ["inputActions"],
    resolve: (binding) => {
      trackBinding(binding);
      const shell = inputHub.shellFor(binding);
      const conversation = uiConversation.binding(binding);
      restoreView(binding.sessionId);
      return {
        hooks: {
          conversation: conversation.snapshot,
          input: shell.state,
        },
        props: { inputActions: shell.actions },
      };
    },
  });

  const registerConversationRoot = () =>
    slots.register(
      {
        name: "main.conversation",
        children: {
          "conversation.header": { kind: "single", scope: "session-maybe" },
        },
      },
      ConversationRoot,
    );

  // 外层头部（上游 0.1.7 拆出）：`conversation.header.leading` 是 root 作用域的席位，
  // 会话头 `conversation.session.header` 挂在它下面——两者不再是同一格。
  const registerHeader = () =>
    slots.register(
      {
        name: "conversation.header",
        children: {
          "conversation.header.leading": { kind: "single", scope: "root" },
          "conversation.session.header": { kind: "single", scope: "session" },
        },
      },
      ConversationHeader,
    );

  const registerConversationContent = () =>
    slots.registerFactory(
      {
        name: "conversation.content",
        scope: "session-maybe",
        locale: NS,
        children: {
          "conversation.session": { kind: "single", scope: "session" },
          "conversation.composer": { kind: "chain", scope: "session" },
          "conversation.composer.bar": { kind: "single", scope: "session-maybe" },
          "conversation.input.dock": { kind: "list", scope: "session" },
          "conversation.hero.brand.mark": { kind: "single", scope: "root" },
          "conversation.hero.workspace": { kind: "single", scope: "root" },
          "conversation.hero.agentPreset": { kind: "single", scope: "session-maybe" },
        },
        slots: {
          views: { scope: "session" },
          widthControls: { scope: "root" },
        },
        inject: (sessionId: SessionId | undefined): ConversationInjected => ({
          hooks: {
            composerBlock:
              sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId),
          },
          selectWorkspace: (workspaceId) =>
            workspaceNavigation.openWorkspace(workspaceId, (nextId) => {
              if (sessionId !== undefined && nextId !== sessionId) {
                const from = inputHub.shell(sessionId);
                const draft = from.snapshot.draft;
                const attachmentIds = from.snapshot.attachmentIds;
                const next = inputHub.shell(nextId);
                if (attachmentIds.length === 0 || next.addAttachments(attachmentIds)) {
                  if (sessions.binding(nextId) === undefined) {
                    throw new Error(`ui-conversation: session "${nextId}" resolved no binding`);
                  }
                  concreteConversation(ctx).rebindDraftFiles(nextId, attachmentIds);
                  if (draft !== "") {
                    next.setDraft(draft);
                    from.setDraft("");
                  }
                  if (attachmentIds.length > 0) {
                    for (const id of attachmentIds) from.removeAttachment(id);
                  }
                }
              }
            }),
        }),
      },
      ConversationContent,
    );

  const registerConversationSession = () =>
    slots.register(
      {
        name: "conversation.session",
        children: {
          "conversation.view": { kind: "list", scope: "session" },
        },
        store: conversationStore,
        inject: (
          sessionId: SessionId,
          actions: BoundActions<typeof conversationStore>,
        ): ConversationSessionInjected => {
          const openView = (view: string, focus: string): void => {
            if (!viewTabs().some((tab) => tab.id === view)) return;
            activateView(sessionId, view);
            actions.openView(view, focus);
          };
          // 工具调用要跳到某个 View 的对应位置：只有「已注册且当前可见」的 View 才接得住这次定位。
          const inspectionTarget = () =>
            uiConversation.views
              .entries()
              .find(
                (definition) =>
                  definition.toolCallFocus !== undefined &&
                  conversationViews.getSnapshot().some((view) => view.id === definition.target),
              );
          const inspectCall = (callId: string): void => {
            const target = inspectionTarget();
            if (target?.toolCallFocus !== undefined)
              openView(target.target, target.toolCallFocus(callId));
          };
          return {
            hooks: {
              conversationViews,
              inspectCall: {
                getSnapshot: () => (inspectionTarget() === undefined ? undefined : inspectCall),
                subscribe: (listener) => {
                  const disposeViews = conversationViews.subscribe(listener);
                  const disposeDefinitions = uiConversation.views.subscribe(listener);
                  return () => {
                    disposeViews();
                    disposeDefinitions();
                  };
                },
              },
            },
            bindDraftMirror: (write) => inputHub.shell(sessionId).bindMirror(write),
            openView,
          };
        },
      },
      ConversationSession,
    );

  const registerConversationHeader = () =>
    slots.register(
      {
        name: "conversation.session.header",
        locale: NS,
        children: {
          "conversation.session.header.lineage": { kind: "single", scope: "session" },
          "conversation.session.header.actions": { kind: "list", scope: "session" },
          "conversation.session.header.utilities": { kind: "list", scope: "session" },
          "conversation.session.header.corner": { kind: "single", scope: "session" },
        },
        store: conversationStore,
        inject: (
          sessionId: SessionId,
          actions: BoundActions<typeof conversationStore>,
        ): ConversationSessionHeaderInjected => ({
          hooks: { conversationViews },
          open: (id) => {
            workspaceNavigation.openSession(id);
          },
          selectView: (view) => {
            activateView(sessionId, view);
            actions.setView(view);
          },
        }),
      },
      ConversationSessionHeader,
    );

  const registerComposerBar = () =>
    slots.register(
      {
        name: "conversation.composer.bar",
        locale: NS,
        children: {
          "conversation.input.attachments": { kind: "single", scope: "session-maybe" },
          "conversation.input.overlay": { kind: "list", scope: "session" },
          "conversation.input.permission": { kind: "single", scope: "session" },
          "conversation.input.left": { kind: "list", scope: "session" },
          "conversation.input.plan": { kind: "single", scope: "session" },
          "conversation.input.right": { kind: "list", scope: "session" },
          "conversation.input.model": { kind: "single", scope: "session" },
          "conversation.input.activity": { kind: "single", scope: "session" },
          "conversation.composer.dock": { kind: "list", scope: "session" },
        },
        inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
          if (sessionId === undefined) {
            return {
              keyboard: undefined,
              addFiles: undefined,
              removeAttachment: undefined,
              resolveDraftAttachments: undefined,
              retryFileUpload: undefined,
              toggleCommandMenu: undefined,
              stop: undefined,
              hooks: {
                busyEnter: submissionPolicy.busyEnter,
                fileUploads: ABSENT_FILE_UPLOADS,
                notices: ABSENT_NOTICES,
                lexicon: ABSENT_LEXICON,
                menuLauncher: ABSENT_MENU_LAUNCHER,
              },
            };
          }
          const conversation = concreteConversation(ctx);
          const shell = inputHub.shell(sessionId);
          const inputTriggers = inputHub.inputTriggers(sessionId);
          return {
            keyboard: shell,
            addFiles: (files) => {
              if (sessions.binding(sessionId) === undefined) return t("file.sessionUnavailable");
              try {
                const drafts = conversation.createDrafts(sessionId, files);
                if (!shell.addAttachments(drafts.map((draft) => draft.id))) {
                  conversation.releaseDraftAttachments(drafts);
                }
                return null;
              } catch (error: unknown) {
                if (error instanceof UnsupportedImageMediaTypeError)
                  return t("image.unsupportedType");
                return error instanceof Error ? error.message : String(error);
              }
            },
            removeAttachment: (id) => {
              if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id);
            },
            resolveDraftAttachments: (ids) => conversation.resolveDraftAttachments(ids),
            retryFileUpload: (id) => {
              if (sessions.binding(sessionId) !== undefined)
                conversation.retryFileUpload(sessionId, id);
            },
            toggleCommandMenu:
              inputTriggers === undefined
                ? undefined
                : (selection) => {
                    shell.dismissPopup();
                    const snapshot = shell.snapshot;
                    inputTriggers.toggleSource("command", {
                      trigger: "/",
                      query: "",
                      quoted: false,
                      position:
                        snapshot.draft.slice(0, selection.start).trim() === ""
                          ? "leading"
                          : "inline",
                      span: { ...selection, draftRev: snapshot.draftRev },
                    });
                  },
            stop: () => {
              scopedConversation(sessions, sessionId)
                .cancel()
                .catch(() => {});
            },
            hooks: {
              busyEnter: submissionPolicy.busyEnter,
              fileUploads: conversation.fileUploads,
              notices: shell.notices,
              lexicon: shell.lexicon,
              menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
            },
          };
        },
      },
      InputBar,
    );

  slots.inject("main", function* () {
    yield slots.register(
      {
        name: "main",
        key: "conversation",
        children: { "main.conversation": { kind: "single", scope: "session-maybe" } },
      },
      ConversationPanel,
    );
    yield registerConversationRoot();
    yield registerHeader();
    yield registerConversationContent();
    yield registerConversationSession();
    yield registerConversationHeader();
    yield registerComposerBar();
  });

  ctx.plugin(ConversationController, {
    input: inputHub,
    blocks: composerBlocks,
    maxConcurrentFileUploads,
  });
  ctx.plugin(todoDockEntry);
  ctx.plugin(queueDockEntry);
}

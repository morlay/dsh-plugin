import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import { Locale } from "@morlay/dsh-web-app/locale/client/tokens";
import { Sessions } from "@morlay/dsh-web-app/session/client/tokens";
import { Slots } from "@morlay/dsh-web-app/renderer/client/tokens";
import { UiWorkspace } from "@morlay/dsh-web-app/workspace/client/tokens";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { ConversationManagerController } from "./controller.ts";
import { ConversationManagerIcon } from "./ConversationManagerIcon.tsx";
import { ConversationManagerPage } from "./ConversationManagerPage.tsx";
import { en, zh } from "./locales.ts";

// 本包字典的 namespace。
export const NS: string = "conversationManager";

// nav 行与主面板共用的 id。
export const PANEL_ID = "conversations" as MainPanelId;

// nav 行的位置：紧邻官方 Plugins 行（order 0）。
export const PANEL_ORDER = 1;

@Injectable()
export class ConversationManager {
  // 浏览器侧 cordis 的依赖声明（与下面的字段注入同一份名单）。
  static readonly inject = ["slots", "locale", "uiWorkspace", "sessions"];

  slots = inject(Slots);

  locale = inject(Locale);

  uiWorkspace = inject(UiWorkspace);

  sessions = inject(Sessions);

  onInit(ctx: Context): void {
    // 基础面（内联库）由 `@morlay/zephyr-app` 的 client 行统一装配；这里只注册本行的字段文案。
    ctx.effect(() => {
      const offs = [this.locale.register(NS, "zh", zh), this.locale.register(NS, "en", en)];
      return () => {
        for (const off of offs) off();
      };
    }, "ui-conversation-manager: dictionaries");
    const t = this.locale.bind(NS);
    // 列表刷新入口在运行时可能缺席：有就调、没有就跳过。
    const refreshList = (this.sessions as unknown as { refresh?: () => Promise<void> }).refresh;
    const controller = new ConversationManagerController({
      archiveSession: (sessionId) => this.uiWorkspace.archiveSession(sessionId),
      unarchiveSession: (sessionId) => this.uiWorkspace.unarchiveSession(sessionId),
      refresh: async () => {
        await refreshList?.call(this.sessions);
      },
    });

    this.slots.inject("main", () =>
      this.slots.register(
        {
          name: "main",
          key: PANEL_ID,
          locale: NS,
          // slots 的实现会调用这个函数拿 face；延迟到注册时读 controller。
          inject: () => controller.face,
        },
        ConversationManagerPage,
      ),
    );

    this.slots.inject("sidebar.panellist", () =>
      this.slots.register(
        {
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: PANEL_ORDER,
          label: () => t("panel"),
          locale: NS,
        },
        ConversationManagerIcon,
      ),
    );
  }
}

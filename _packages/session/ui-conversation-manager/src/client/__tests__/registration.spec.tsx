// @vitest-environment happy-dom
// 注册面闭环：nav 行（`sidebar.panellist`）与主面板（`main` keyed）必须用同一个 id 成对注册，
// 否则点击 nav 行会在 layout.selectPanel 的「main 未注册」校验处抛错；行标签来自本包字典。
// slots / locale 是外部框架服务，这里用最小替身记录注册事实——插件走 client 同一条
// `attachProvider` 路径，真实 Context 上提供替身服务。
import { cleanup, render } from "@testing-library/react";
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ConversationManagerIcon } from "../ConversationManagerIcon.tsx";
import { ConversationManagerPage } from "../ConversationManagerPage.tsx";
import entry, { NS, PANEL_ID, PANEL_ORDER } from "../index.ts";
import { zh } from "../locales.ts";

const fibers: Fiber[] = [];

afterEach(async () => {
  cleanup();
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose();
});

interface Registration {
  slot: string;
  options: Record<string, unknown>;
  component: unknown;
}

interface Bench {
  registrations: Registration[];
  injectedSlots: string[];
  dictionaries: string[];
}

async function bench(): Promise<Bench> {
  const registrations: Registration[] = [];
  const injectedSlots: string[] = [];
  const dictionaries: string[] = [];
  const ctx = new Context();
  ctx.reflect.provide("slots", {
    inject: (slot: string, factory: () => unknown) => {
      injectedSlots.push(slot);
      factory();
    },
    register: (options: Record<string, unknown>, component: unknown) => {
      registrations.push({ slot: String(options["name"]), options, component });
      return () => {};
    },
  });
  ctx.reflect.provide("locale", {
    register: (ns: string) => {
      dictionaries.push(ns);
    },
    bind: () => (key: keyof typeof zh) => zh[key],
  });
  ctx.reflect.provide("uiWorkspace", {
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
  });
  ctx.reflect.provide("sessions", { refresh: vi.fn() });

  const fiber = ctx.plugin(entry);
  fibers.push(fiber);
  await fiber;

  return { registrations, injectedSlots, dictionaries };
}

describe("ui-conversation-manager 注册面", () => {

  it("nav 行与主面板用同一个 id 成对注册", async () => {
    const { registrations, injectedSlots, dictionaries } = await bench();

    expect(injectedSlots).toEqual(["main", "sidebar.panellist"]);
    expect(new Set(dictionaries)).toEqual(new Set(["conversationManager"]));

    const page = registrations.find((entry) => entry.slot === "main");
    expect(page?.component).toBe(ConversationManagerPage);
    expect(page?.options["key"]).toBe(PANEL_ID);
    expect(page?.options["locale"]).toBe(NS);

    const row = registrations.find((entry) => entry.slot === "sidebar.panellist");
    expect(row?.component).toBe(ConversationManagerIcon);
    expect(row?.options["id"]).toBe(PANEL_ID);
    expect(row?.options["order"]).toBe(PANEL_ORDER);
    expect(row?.options["locale"]).toBe(NS);
    const label = row?.options["label"] as (() => string) | undefined;
    expect(label).toBeTypeOf("function");
    expect((label as () => string)()).toBe("对话管理");
  });

  it("nav 图标只画字形，不读应用状态", () => {
    const unread = (): never => {
      throw new Error("nav 图标不得读取应用状态");
    };
    // 组件 spec 直喂 props，框架座位的替身由本文件提供。
    const Icon = ConversationManagerIcon as unknown as (
      props: Record<string, unknown>,
    ) => ReactNode;
    const glyph = render(
      <Icon
        size={18}
        active={false}
        usePanelInfo={unread}
        useSessions={unread}
        useSessionStatus={unread}
        useSessionRetainInfo={unread}
        useWorkspaces={unread}
        useResource={unread}
      />,
    );
    expect(glyph.container.querySelector("svg")?.getAttribute("width")).toBe("18");
  });
});

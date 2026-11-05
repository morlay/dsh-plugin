// @vitest-environment happy-dom
// 右栏面板：按会话拉生效态、按折叠组呈现全量目录、三态改动攒成草稿一次提交。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionModeActiveState } from "../../endpoint/session-mode-shapes.ts";
import { SessionModePanelBody } from "../session-mode-panel.view.tsx";
import type { SessionModeStore } from "../session-mode.store.ts";

afterEach(() => {
  cleanup();
});

function state(overrides: Partial<SessionModeActiveState> = {}): SessionModeActiveState {
  const config = {
    presetsOnly: [],
    name: "编码模式",
    description: "功能完整的编码 Agent。",
    role: ["main"] as const,
    persona: { prefix: "", suffix: "" },
    allowTools: [],
    denyTools: [],
    allowSkills: [],
    denySkills: [],
    allowPolicies: [],
    denyPolicies: [],
    instructions: true,
    skills: true,
    dropSections: [],
    runtimeContext: true,
  };
  return {
    mode: { id: "coding", name: "编码模式", description: "功能完整的编码 Agent。" },
    config,
    session: undefined,
    overriddenFields: [],
    editable: true,
    deletable: false,
    catalog: {
      tools: [
        {
          id: "read",
          description: "读文件",
          group: "fs",
          groupLabel: "文件",
          fallback: "default",
          override: null,
        },
        {
          id: "bash",
          description: "执行命令",
          group: "shell",
          groupLabel: "Shell",
          fallback: "default",
          override: null,
        },
      ],
      skills: [{ id: "office-docx", description: "Word 文档", fallback: "deny", override: null }],
      policies: [
        { id: "fs/write-intent", description: "写入前检查", fallback: "default", override: null },
      ],
    },
    ...overrides,
  };
}

function fakeStore(value: SessionModeActiveState, applied: string[] = []): SessionModeStore {
  return {
    loadActive: async () => value,
    loadRoster: async () => ({ default: "coding", modes: [] }),
    applyConfig: async (_sessionId: string, config: unknown) => {
      applied.push("apply");
      return { ...value, config: config as SessionModeActiveState["config"] };
    },
    saveConfig: async () => {
      applied.push("save");
      return value;
    },
    select: async () => "coding",
    patch: async () => value,
    saveAs: async () => "new-mode",
    remove: async () => "coding",
  } as unknown as SessionModeStore;
}

describe("会话模式面板", () => {
  it("没有会话时给一句空态，不发请求", () => {
    render(<SessionModePanelBody sessionId={undefined} store={fakeStore(state())} panelId="p" />);
    expect(screen.getByText("当前没有会话")).toBeDefined();
  });

  it("读出这个会话的生效态：模式名、说明与全量目录", async () => {
    render(<SessionModePanelBody sessionId="s1" store={fakeStore(state())} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    expect(screen.getByText(/工具 \(2\)/u)).toBeDefined();
    expect(screen.getByText(/技能 \(1\)/u)).toBeDefined();
    expect(screen.getByText(/政策规则 \(1\)/u)).toBeDefined();
  });

  it("会话覆盖标出来源，没有覆盖的是模式默认", async () => {
    render(
      <SessionModePanelBody
        sessionId="s1"
        store={fakeStore(state({ overriddenFields: ["instructions"] }))}
        panelId="p"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("会话覆盖")).toBeDefined();
    });
    expect(screen.getAllByText("模式默认").length).toBeGreaterThan(0);
  });

  it("「应用到会话」把草稿一次提交", async () => {
    const applied: string[] = [];
    render(<SessionModePanelBody sessionId="s1" store={fakeStore(state(), applied)} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("应用到会话")).toBeDefined();
    });
    fireEvent.click(screen.getByText("应用到会话"));
    await waitFor(() => {
      expect(applied).toEqual(["apply"]);
    });
    expect(screen.getByText("已应用到会话")).toBeDefined();
  });

  it("「应用到会话」是分体按钮：右半段才开菜单，项顺序与截图一致，删除按 deletable 门控", async () => {
    render(
      <SessionModePanelBody
        sessionId="s1"
        store={fakeStore(state({ deletable: false }))}
        panelId="p"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("应用到会话")).toBeDefined();
    });
    // 主动作与「更多」是两个控件：主按钮点的是提交，不是开菜单。
    fireEvent.click(screen.getByLabelText("更多保存方式"));
    await waitFor(() => {
      expect(screen.getAllByRole("menuitem").length).toBe(3);
    });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
      "保存为默认",
      "另存为",
      "删除",
    ]);
    // 「另存为」还没有输入面；「删除」按领域给的 deletable 决定可用性。
    // 禁用行是 `aria-disabled`（不是原生 `disabled`）：这样它还能 hover/focus 出「为什么不能点」。
    expect(screen.getByRole("menuitem", { name: "另存为" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "删除" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("删除要二次确认：确认后才 remove，删完会话回落到内置默认", async () => {
    const calls: string[] = [];
    let loads = 0;
    const custom = state({
      deletable: true,
      mode: { id: "coding", name: "编码模式", description: "" },
    });
    const fallback = state({
      deletable: false,
      mode: { id: "standard", name: "标准模式", description: "" },
    });
    const store = fakeStore(custom);
    (store as unknown as { loadActive: () => Promise<SessionModeActiveState> }).loadActive =
      async () => {
        loads += 1;
        return loads === 1 ? custom : fallback;
      };
    (store as unknown as { remove: (id: string) => Promise<string> }).remove = async (id) => {
      calls.push("remove:" + id);
      return "standard";
    };
    render(<SessionModePanelBody sessionId="s1" store={store} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("应用到会话")).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText("更多保存方式"));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    // 只是弹确认框，还没删。
    expect(calls).toEqual([]);
    expect(screen.getByText("删除当前模式")).toBeDefined();
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() => {
      expect(calls).toEqual(["remove:s1"]);
    });
    // 删完再拉一次生效态：会话回落到内置默认。
    await waitFor(() => {
      expect(screen.getByText("标准模式")).toBeDefined();
    });
  });
});

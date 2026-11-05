// @vitest-environment jsdom
// 右栏面板：只展示当前会话选中的模式与它当下生效的那一份（数据来自 host 的生效态接口）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionModeActiveState } from "../../shared.ts";
import { SessionModePanel, type SessionModePanelProps } from "../SessionModePanel.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACTIVE: SessionModeActiveState = {
  mode: {
    id: "coding",
    name: "编码模式",
    description: "功能完整的编码 Agent。",
    persona: { prefix: "你是编程专家。", suffix: "" },
  },
  tools: ["bash", "read", "tool_group_load"],
  skills: ["dsh-usage-base"],
  policies: ["fs/write-intent"],
  switches: { instructions: true, skills: true, runtimeContext: false },
  switchDefaults: { instructions: true, skills: true, runtimeContext: false },
  overriddenSwitches: [],
  defaults: {
    persona: { prefix: "你是编程专家。", suffix: "" },
    allowTools: [],
    denyTools: [],
    allowSkills: [],
    denySkills: [],
    allowPolicies: [],
    denyPolicies: [],
    instructions: true,
    skills: true,
    runtimeContext: false,
  },
  effective: {
    persona: { prefix: "你是编程专家。", suffix: "" },
    allowTools: [],
    denyTools: [],
    allowSkills: [],
    denySkills: [],
    allowPolicies: [],
    denyPolicies: [],
    instructions: true,
    skills: true,
    runtimeContext: false,
  },
  overriddenFields: [],
  deletable: false,
  catalog: {
    tools: [
      { id: "bash", description: "运行 Shell。", group: "core" },
      {
        id: "mcp__browser__open",
        description: "打开网页。",
        group: "MCP · browser",
        groupLabel: "MCP · browser",
        fallback: "deny",
        override: null,
      },
    ],
    skills: [{ id: "dsh-usage-base", description: "用法分组。" }],
    policies: [{ id: "fs/write-intent", description: "写入意图。" }],
  },
};

function props(): SessionModePanelProps {
  return {
    sessionId: "session-1",
    useSessions: ((selector: (state: unknown) => unknown) =>
      selector({
        byId: { "session-1": { projectionValues: { sessionMode: "coding" } } },
      })) as unknown as SessionModePanelProps["useSessions"],
    t: ((key: string) => key) as PropsLocale<"session-mode">["t"],
  } as unknown as SessionModePanelProps;
}

describe("右栏的会话模式面板", () => {
  it("列出选中的模式与生效的工具 / 技能 / policy / 开关", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ACTIVE), { status: 200 })),
    );

    render(<SessionModePanel {...props()} />);

    await waitFor(() => expect(screen.getByText("编码模式")).toBeTruthy());
    expect(screen.getByText("general")).toBeTruthy();
    expect(screen.getAllByRole("switch").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/tools \(2\)/u));
    await waitFor(() => expect(screen.getByText(/MCP · browser \(1\)/u)).toBeTruthy());
    fireEvent.click(screen.getByText(/MCP · browser \(1\)/u));
    await waitFor(() => expect(screen.getByText("mcp__browser__open")).toBeTruthy());
    expect(screen.getByText("打开网页。")).toBeTruthy();
    // 三态控件渲染出来即可：选中态语义由 host 的 override/fallback 决定，另有独立用例覆盖。
    expect(screen.getByText(/MCP · browser \(1\)/u)).toBeTruthy();
  });

  it("没有会话时给出提示，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const noSession = { ...props(), sessionId: undefined } as unknown as SessionModePanelProps;
    render(<SessionModePanel {...noSession} />);

    await waitFor(() => expect(screen.getByText("panelNoSession")).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("开关与保存按钮都打到 host 的写面", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const body = typeof init?.body === "string" ? init.body : "";
        calls.push({ url, body });
        if (init?.method === "POST" && body.includes("saveAsDefault")) {
          return new Response(JSON.stringify(ACTIVE), { status: 200 });
        }
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ...ACTIVE,
              switches: { ...ACTIVE.switches, instructions: false },
              overriddenSwitches: ["instructions"],
              overriddenFields: ["instructions"],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(ACTIVE), { status: 200 });
      }),
    );

    render(<SessionModePanel {...props()} />);
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

    // 改开关只是本地草稿：不发请求。
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    expect(calls.some((call) => call.body.includes('"applyConfig"'))).toBe(false);

    // 点"应用到会话"才一次提交。
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() =>
      expect(calls.some((call) => call.body.includes('"applyConfig"'))).toBe(true),
    );
    expect(calls.some((call) => call.body.includes('"instructions":false'))).toBe(true);

    // 保存为默认在右上角的 "…" 菜单里。
    fireEvent.click(screen.getByText("…"));
    fireEvent.click(await screen.findByText("saveDefault"));
    await waitFor(() => expect(screen.getByText("saved")).toBeTruthy());
    expect(calls.some((call) => call.body.includes('"saveConfig"'))).toBe(true);
  });

  it("保存为默认只写配置，不经过应用到会话", async () => {
    const calls: { body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body === "string") calls.push({ body: init.body });
        return new Response(JSON.stringify(ACTIVE), { status: 200 });
      }),
    );

    render(<SessionModePanel {...props()} />);
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

    // 改一个开关（只进草稿），再走菜单里的"保存为默认"。
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    expect(calls.some((call) => call.body.includes("applyConfig"))).toBe(false);

    fireEvent.click(screen.getByText("…"));
    fireEvent.click(await screen.findByText("saveDefault"));

    await waitFor(() => expect(calls.some((call) => call.body.includes("saveConfig"))).toBe(true));
    // 保存走独立的配置写面，不经过"应用到会话"。
    expect(calls.some((call) => call.body.includes("applyConfig"))).toBe(false);
  });
});

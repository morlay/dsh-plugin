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
  session: undefined,
  config: {
    presetsOnly: [],
    name: "编码模式",
    description: "功能完整的编码 Agent。",
    role: ["main"],
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
  mode: {
    id: "coding",
    name: "编码模式",
    description: "功能完整的编码 Agent。",
  },
  deletable: false,
  catalog: {
    tools: [
      { id: "bash", description: "运行 Shell。", group: "core" },
      {
        id: "mcp__browser__open",
        description: "打开网页。",
        group: "mcp:browser",
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
              // 会话覆盖是整份配置：改开关就是把覆盖里的这一项改掉。
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
    fireEvent.click(screen.getByText("▾"));
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

    fireEvent.click(screen.getByText("▾"));
    fireEvent.click(await screen.findByText("saveDefault"));

    await waitFor(() => expect(calls.some((call) => call.body.includes("saveConfig"))).toBe(true));
    // 保存走独立的配置写面，不经过"应用到会话"。
    expect(calls.some((call) => call.body.includes("applyConfig"))).toBe(false);
  });
});

// 会话覆盖存在时，`active.config` 与 `active.session` 是两份：UI 显示的是后者。
const WITH_SESSION: SessionModeActiveState = {
  ...ACTIVE,
  session: { ...ACTIVE.config, denyTools: ["bash"] },
};

describe("有会话覆盖时的提交基座", () => {
  it("应用到会话带的是屏幕上那份（effective），不是模式默认", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body === "string") bodies.push(init.body);
        return new Response(JSON.stringify(WITH_SESSION), { status: 200 });
      }),
    );

    render(<SessionModePanel {...props()} />);
    await waitFor(() => expect(screen.getByText("编码模式")).toBeTruthy());

    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => expect(bodies.some((body) => body.includes('"applyConfig"'))).toBe(true));

    const body = bodies.find((entry) => entry.includes('"applyConfig"'))!;
    const payload = JSON.parse(body) as { applyConfig: { config: { denyTools: string[] } } };
    expect(payload.applyConfig.config.denyTools).toContain("bash");
  });
});

describe("共用同一份 ViewModel", () => {
  it("同一份草稿：应用到会话与保存为默认发出去的 config 逐字节相同", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (body.length > 0) bodies.push(body);
        // 应用到会话之后，host 的生效态就是那份覆盖（否则面板会回到模式默认，第二次渲染的基座就不一样了）。
        const applied = body.includes('"applyConfig"')
          ? ((JSON.parse(body) as { applyConfig: { config: unknown } }).applyConfig.config as
              | SessionModeActiveState["config"]
              | undefined)
          : undefined;
        return new Response(
          JSON.stringify(applied === undefined ? ACTIVE : { ...ACTIVE, session: applied }),
          { status: 200 },
        );
      }),
    );

    render(<SessionModePanel {...props()} />);
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

    // 改一个开关（只动草稿）→ 应用 → 保存为默认。
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => expect(bodies.some((body) => body.includes('"applyConfig"'))).toBe(true));
    fireEvent.click(screen.getByText("▾"));
    fireEvent.click(await screen.findByText("saveDefault"));
    await waitFor(() => expect(bodies.some((body) => body.includes('"saveConfig"'))).toBe(true));

    const applied = bodies.find((body) => body.includes('"applyConfig"'))!;
    const saved = bodies.find((body) => body.includes('"saveConfig"'))!;
    const appliedConfig = (JSON.parse(applied) as { applyConfig: { config: unknown } }).applyConfig
      .config;
    const savedConfig = (JSON.parse(saved) as { saveConfig: { config: unknown } }).saveConfig
      .config;
    expect(savedConfig).toEqual(appliedConfig);
  });
});

// @vitest-environment happy-dom
// 右栏面板：按会话拉生效态、按折叠组呈现全量目录、三态改动攒成草稿一次提交；
// 逐字段「恢复默认」走 `setModePatch(id, null)`；工具段的「只看可调用」是纯展示层过滤。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ModeConfig } from "../../endpoint/mode-config.ts";
import type { SessionModeActiveState } from "../../endpoint/session-mode-shapes.ts";
import { SessionModePanelBody } from "../session-mode-panel.view.tsx";
import type { SessionModeStore } from "../session-mode.store.ts";

afterEach(() => {
  cleanup();
});

function config(extra: Partial<ModeConfig> = {}): ModeConfig {
  return {
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
    ...extra,
  };
}

function state(overrides: Partial<SessionModeActiveState> = {}): SessionModeActiveState {
  const base = config();
  return {
    mode: { id: "coding", name: "编码模式", description: "功能完整的编码 Agent。" },
    config: base,
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

// 展开某个折叠组：标题按钮的文本就是组名（后面跟着 +/− 的状态符号）。
function openSection(title: string): void {
  fireEvent.click(screen.getByText(title));
}

describe("会话模式面板", () => {
  it("没有会话时给一句空态，不发请求", () => {
    let loads = 0;
    const store = fakeStore(state());
    (store as unknown as { loadActive: (id: string) => Promise<SessionModeActiveState> })
      .loadActive = async () => {
      loads += 1;
      return state();
    };
    render(<SessionModePanelBody sessionId={undefined} store={store} panelId="p" />);
    expect(screen.getByText("当前没有会话")).toBeDefined();
    expect(loads).toBe(0);
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

  it("被覆盖的字段标会话覆盖，其余标模式默认", async () => {
    render(
      <SessionModePanelBody
        sessionId="s1"
        store={fakeStore(
          state({
            config: config({ persona: { prefix: "你会先读后改。", suffix: "" } }),
            session: config({ persona: { prefix: "你会先读后改。", suffix: "" } }),
            overriddenFields: ["instructions", "persona"],
          }),
        )}
        panelId="p"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    // general 段：三个开关的行各有来源；其中只有 instructions 被覆盖（一次只开一组，此时别的段收着）。
    expect(screen.getAllByText("会话覆盖").length).toBe(1);
    expect(screen.getAllByText("模式默认").length).toBe(2);
    // persona 段两个输入共用同一个字段来源：两行都标"会话覆盖"。
    openSection("系统提示词");
    await waitFor(() => {
      expect(screen.getByLabelText("前缀")).toBeDefined();
    });
    expect(screen.getAllByText("会话覆盖").length).toBe(2);
    expect(screen.queryByText("模式默认")).toBeNull();
  });

  it("persona 段：改 prefix 与 suffix 进草稿", async () => {
    const commits: ModeConfig[] = [];
    const value = state({ config: config({ persona: { prefix: "旧前缀", suffix: "旧后缀" } }) });
    const store = fakeStore(value);
    (
      store as unknown as {
        applyConfig: (id: string, next: ModeConfig) => Promise<SessionModeActiveState>;
      }
    ).applyConfig = async (_id, next) => {
      commits.push(next);
      return { ...value, config: next };
    };
    render(<SessionModePanelBody sessionId="s1" store={store} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    // 段没展开时不该有输入框：persona 是**渲染出来**的，不是只存在数据里。
    expect(screen.queryByLabelText("前缀")).toBeNull();
    openSection("系统提示词");
    const prefix = screen.getByLabelText("前缀");
    const suffix = screen.getByLabelText("后缀");
    expect((prefix as HTMLTextAreaElement).value).toBe("旧前缀");
    fireEvent.change(prefix, { target: { value: "先读后改。" } });
    fireEvent.change(suffix, { target: { value: "改完自测。" } });
    // 只改了草稿，还没提交。
    expect(commits).toEqual([]);
    fireEvent.click(screen.getByText("应用到会话"));
    await waitFor(() => {
      expect(commits.length).toBe(1);
    });
    expect(commits[0]?.persona).toEqual({ prefix: "先读后改。", suffix: "改完自测。" });
  });

  it("persona 的「恢复默认」清的就是 persona 这一个字段", async () => {
    const patches: Readonly<Record<string, unknown>>[] = [];
    const value = state({
      config: config({ persona: { prefix: "你是审查者。", suffix: "" } }),
      overriddenFields: ["persona"],
    });
    const store = fakeStore(value);
    (
      store as unknown as {
        patch: (
          id: string,
          patch: Readonly<Record<string, unknown>>,
        ) => Promise<SessionModeActiveState>;
      }
    ).patch = async (_id, patch) => {
      patches.push(patch);
      return { ...value, overriddenFields: [] };
    };
    render(<SessionModePanelBody sessionId="s1" store={store} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    openSection("系统提示词");
    await waitFor(() => {
      expect(screen.getByLabelText("前缀")).toBeDefined();
    });
    // 两行各有一个入口，点哪个都清同一个字段。
    fireEvent.click(screen.getAllByRole("button", { name: "恢复默认" })[1] as HTMLElement);
    await waitFor(() => {
      expect(patches.length).toBe(1);
    });
    expect(patches[0]).toEqual({ persona: null });
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

  it("应用到会话：一次提交整份草稿", async () => {
    const commits: ModeConfig[] = [];
    const value = state();
    const store = fakeStore(value);
    (
      store as unknown as {
        applyConfig: (id: string, next: ModeConfig) => Promise<SessionModeActiveState>;
      }
    ).applyConfig = async (_id, next) => {
      commits.push(next);
      return { ...value, config: next };
    };
    render(<SessionModePanelBody sessionId="s1" store={store} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("应用到会话")).toBeDefined();
    });
    // 改一个开关：提交的是**整份**配置（不是改过的那几项 diff）。
    fireEvent.click(screen.getByRole("switch", { name: "工作区指令" }));
    fireEvent.click(screen.getByText("应用到会话"));
    await waitFor(() => {
      expect(commits.length).toBe(1);
    });
    expect(commits[0]).toEqual({ ...config(), instructions: false });
  });

  it("恢复默认：某个字段回到模式默认", async () => {
    const patches: { sessionId: string; patch: Readonly<Record<string, unknown>> }[] = [];
    // 这个会话把 instructions 覆盖成了"关"，模式默认是"开"。
    const value = state({
      config: config({ instructions: true }),
      session: config({ instructions: false }),
      overriddenFields: ["instructions"],
    });
    const cleared: SessionModeActiveState = {
      ...value,
      session: undefined,
      overriddenFields: [],
    };
    const store = fakeStore(value);
    (
      store as unknown as {
        patch: (
          id: string,
          patch: Readonly<Record<string, unknown>>,
        ) => Promise<SessionModeActiveState>;
      }
    ).patch = async (id, patch) => {
      patches.push({ sessionId: id, patch });
      return cleared;
    };
    render(<SessionModePanelBody sessionId="s1" store={store} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("会话覆盖")).toBeDefined();
    });
    const toggle = screen.getByRole("switch", { name: "工作区指令" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() => {
      expect(patches.length).toBe(1);
    });
    // `null` = 只清这个字段的会话覆盖（宿主把该键从覆盖里摘掉，其余字段不动）。
    expect(patches[0]).toEqual({ sessionId: "s1", patch: { instructions: null } });
    // 拉回来的生效态里这一项已经是模式默认。
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "工作区指令" }).getAttribute("aria-checked")).toBe(
        "true",
      );
    });
    // 三个开关都在模式默认档上（每行一个来源标注）。
    expect(screen.getAllByText("模式默认").length).toBe(3);
    // 清干净了：这一项不再给「恢复默认」。
    expect(screen.queryByRole("button", { name: "恢复默认" })).toBeNull();
  });

  it("没有覆盖的字段不给「恢复默认」", async () => {
    render(<SessionModePanelBody sessionId="s1" store={fakeStore(state())} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: "恢复默认" })).toBeNull();
  });

  it("过滤开关打开后列表只剩可用项", async () => {
    // bash 所在的工具组被这个会话 deny 掉了：它在目录里，但不可调用。
    const value = state({
      config: config({ denyTools: ["group:shell"] }),
      overriddenFields: ["tools"],
    });
    render(<SessionModePanelBody sessionId="s1" store={fakeStore(value)} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    openSection("工具 (2)");
    // 默认关：两组的行都在（"文件" / "Shell"）。
    expect(screen.getByText(/文件 \(1\)/u)).toBeDefined();
    expect(screen.getByText(/Shell \(1\)/u)).toBeDefined();
    fireEvent.click(screen.getByRole("switch", { name: "只看可调用" }));
    // 打开后只留没被 deny 的那一组（"文件"），被 deny 的 Shell 整组消失。
    await waitFor(() => {
      expect(screen.queryByText(/Shell \(1\)/u)).toBeNull();
    });
    expect(screen.getByText(/文件 \(1\)/u)).toBeDefined();
  });

  it("读失败给整块错误态", async () => {
    const store = fakeStore(state());
    (
      store as unknown as { loadActive: (id: string) => Promise<SessionModeActiveState> }
    ).loadActive = async () => {
      throw new Error("连接断了");
    };
    render(<SessionModePanelBody sessionId="s1" store={store} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    // 是一块带错误文案的区域：不是空列表，也不是一直"读取中…"。
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("读取失败");
    expect(alert.textContent).toContain("连接断了");
    expect(screen.queryByText("读取中…")).toBeNull();
    expect(screen.queryByText(/工具 \(/u)).toBeNull();
  });

  it("写失败：notice 在、草稿还在", async () => {
    const store = fakeStore(state());
    (
      store as unknown as {
        applyConfig: (id: string, next: ModeConfig) => Promise<SessionModeActiveState>;
      }
    ).applyConfig = async () => {
      throw new Error("写入被拒");
    };
    render(<SessionModePanelBody sessionId="s1" store={store} panelId="p" />);
    await waitFor(() => {
      expect(screen.getByText("应用到会话")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("switch", { name: "工作区指令" }));
    fireEvent.click(screen.getByText("应用到会话"));
    await waitFor(() => {
      expect(screen.getByText(/保存失败/u)).toBeDefined();
    });
    expect(screen.getByText(/保存失败/u).textContent).toContain("写入被拒");
    // 草稿没被清：用户可以把同一个改动原样重试。
    expect(screen.getByRole("switch", { name: "工作区指令" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("「应用到会话」是分体按钮：右半段才开菜单，项顺序与截图一致，删除按 deletable 门控", async () => {
    render(<SessionModePanelBody sessionId="s1" store={fakeStore(state())} panelId="p" />);
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

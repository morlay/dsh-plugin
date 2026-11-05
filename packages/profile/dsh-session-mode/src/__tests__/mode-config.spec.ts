// ModeConfig 的两个边界：配置 + session → 生效；ViewModel 相对配置的差异 → session。
// 这里只测纯函数，不碰 host / 面板——边界明确、每个断言都能说出"为什么"。
import { describe, expect, it } from "vitest";
import {
  applyDraft,
  asModeConfig,
  diffModeConfig,
  resolveModeConfig,
  type ModeConfig,
} from "../mode-config.ts";
import type { SessionMode } from "../modes.ts";

function base(overrides: Partial<SessionMode> = {}): SessionMode {
  return {
    presetsOnly: [],
    name: "编码模式",
    description: "",
    role: ["main"],
    persona: { prefix: "配置提示词。", suffix: "" },
    allowTools: [],
    denyTools: ["plugin_manager"],
    allowSkills: [],
    denySkills: [],
    allowPolicies: [],
    denyPolicies: [],
    instructions: true,
    skills: true,
    runtimeContext: true,
    ...overrides,
  };
}

const CONFIG: ModeConfig = asModeConfig(base(), true);

describe("resolveModeConfig：配置 + session → 生效", () => {
  it("没有 session 时生效就是配置本身", () => {
    expect(resolveModeConfig(CONFIG, undefined)).toEqual(CONFIG);
  });

  it("session 是**全量**覆盖：返回的就是它，不做字段 merge", () => {
    const session: ModeConfig = {
      ...structuredClone(CONFIG),
      denyTools: ["plugin_manager", "mcp:agent-browser"],
      instructions: false,
    };
    expect(resolveModeConfig(CONFIG, session)).toEqual(session);
  });

  it("组引用就在数组里：session 放行整组 = 从 denyTools 去掉那条引用", () => {
    const config: ModeConfig = asModeConfig(base({ denyTools: ["mcp:agent-browser"] }), true);
    const effective = resolveModeConfig(config, { ...config, denyTools: [] });
    expect(effective.denyTools).toEqual([]);
  });

  it("不改调用方传入的对象", () => {
    const config: ModeConfig = asModeConfig(base(), true);
    resolveModeConfig(config, { ...config, denyTools: ["read"] });
    expect(config.denyTools).toEqual(["plugin_manager"]);
  });
});

describe("diffModeConfig：ViewModel 相对配置的差异（全量覆盖）", () => {
  it("没改就是没有覆盖", () => {
    expect(diffModeConfig(CONFIG, structuredClone(CONFIG))).toBeUndefined();
  });

  it("改了就是整份 ViewModel 作为覆盖（不是差异字段）", () => {
    const view: ModeConfig = { ...structuredClone(CONFIG), denyTools: [] };
    const session = diffModeConfig(CONFIG, view);
    expect(session).toEqual(view);
    expect(Object.keys(session ?? {}).length).toBe(Object.keys(CONFIG).length);
  });

  it("改回配置值 = 又没有覆盖", () => {
    expect(diffModeConfig(CONFIG, structuredClone(CONFIG))).toBeUndefined();
  });
});

describe("applyDraft：ViewModel 修改 → 符合预期的 ModeConfig", () => {
  it("把组改成默认（unset）：从 denyTools 移出", () => {
    const config: ModeConfig = asModeConfig(base({ denyTools: ["mcp:agent-browser"] }), true);
    const view = applyDraft(config, {
      lists: { tools: { "mcp:agent-browser": "unset" }, skills: {}, policies: {} },
    });
    expect(view.denyTools).toEqual([]);
    expect(view.allowTools).toEqual([]);
  });

  it("单项 allow / deny 落对，unset 从两边移除，且不改原配置", () => {
    const config: ModeConfig = asModeConfig(base({ denyTools: ["read"] }), true);
    const view = applyDraft(config, {
      lists: { tools: { read: "unset", bash: "deny", write: "allow" }, skills: {}, policies: {} },
    });
    expect(view.denyTools).toEqual(["bash"]);
    expect(view.allowTools).toEqual([]);
    expect(config.denyTools).toEqual(["read"]);
  });

  it("白名单模式下 allow 把条目放回白名单", () => {
    const config: ModeConfig = asModeConfig(base({ allowTools: ["read"] }), true);
    const view = applyDraft(config, {
      lists: { tools: { bash: "allow" }, skills: {}, policies: {} },
    });
    expect(view.allowTools).toEqual(["read", "bash"]);
  });

  it("persona 与开关一起叠加", () => {
    const view = applyDraft(CONFIG, {
      persona: { prefix: "会话提示词。", suffix: "" },
      switches: { instructions: false },
    });
    expect(view.persona.prefix).toBe("会话提示词。");
    expect(view.instructions).toBe(false);
  });
});

describe("applyDraft 的默认基座", () => {
  it("switches 写 null 表示回到默认（取默认基座的值，而不是保留覆盖值）", () => {
    const config: ModeConfig = asModeConfig(base(), true);
    const session = { ...config, instructions: false };
    const view = applyDraft(session, { switches: { instructions: null } }, config);
    expect(view.instructions).toBe(true);
  });
});

describe("组引用键的往返", () => {
  it("组键写进 denyTools / allowTools，unset 从两边移除", () => {
    const config: ModeConfig = asModeConfig(base(), true);
    const denied = applyDraft(config, {
      lists: { tools: { "mcp:browser": "deny" }, skills: {}, policies: {} },
    });
    expect(denied.denyTools).toContain("mcp:browser");

    // 空白名单 = 全放行：点"允许"只从 deny 里移除，不写 allow（写了就把配置变成"只允许它"）。
    const allowed = applyDraft(config, {
      lists: { tools: { "mcp:browser": "allow" }, skills: {}, policies: {} },
    });
    expect(allowed.allowTools).not.toContain("mcp:browser");
    expect(allowed.denyTools).not.toContain("mcp:browser");

    // 已有白名单时，"允许"才写进 allowTools。
    const narrow: ModeConfig = { ...config, allowTools: ["read"] };
    const added = applyDraft(narrow, {
      lists: { tools: { "mcp:browser": "allow" }, skills: {}, policies: {} },
    });
    expect(added.allowTools).toContain("mcp:browser");

    const unset = applyDraft(
      { ...config, allowTools: ["mcp:browser"], denyTools: ["mcp:browser"] },
      { lists: { tools: { "mcp:browser": "unset" }, skills: {}, policies: {} } },
    );
    expect(unset.allowTools).not.toContain("mcp:browser");
    expect(unset.denyTools).not.toContain("mcp:browser");
  });
});

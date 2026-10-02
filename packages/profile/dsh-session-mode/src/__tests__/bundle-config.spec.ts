// bundle 配置页的数据面：`session-mode` 行经 host 投影出来的 volatile schema 折成"默认模式 + 模式卡片"，
// 增删模式走字典的 addKey / removeKey，保存只写一次（草稿 → 一次带栅栏的 mutate）。
//
// 接缝是 host 的 schema 投影 → 页面视图（真 `volatileForm` 与真 `Config`，只把 settings 读写面换成替身）。

import z from "@deepseek-ai/schemastery";
import { describe, expect, it, vi } from "vitest";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import {
  createBundleConfigFace,
  mergeTags,
  parseTagList,
  projectBundleConfig,
  type BundleTranslate,
} from "../client/bundle-config.ts";
import { Config } from "../modes.ts";

// 页面字典的替身：把模板参数并进 key，断言里能看见"哪一条文案、带了什么数"。
const t = ((key: string, args?: Record<string, unknown>) =>
  args === undefined ? key : `${key}(${Object.values(args).join(",")})`) as BundleTranslate;

// 一段真实的 config 值：三个模式（含"什么都不加"的 `noop`），字段按 schema 归一化后的形状给全。
const section = {
  default: "coding",
  modes: {
    coding: {
      name: "编码模式",
      description: "编码",
      role: ["main", "subagent"],
      persona: { prefix: "你是编程专家", suffix: "" },
      allowTools: [],
      denyTools: ["load_workspace_dependencies"],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: ["fs/edit-intent"],
      instructions: true,
      runtimeContext: true,
    },
    chat: {
      name: "对话模式",
      description: "对话",
      role: ["main"],
      persona: { prefix: "你是一个助手", suffix: "" },
      allowTools: ["web_search"],
      denyTools: [],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: false,
      runtimeContext: false,
    },
    noop: {
      name: "原样模式",
      description: "与上游一致",
      role: ["main", "subagent"],
      persona: { prefix: "", suffix: "" },
      allowTools: [],
      denyTools: [],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: true,
      runtimeContext: true,
    },
  },
  models: {},
};

interface PathOp {
  op: string;
  path: readonly string[];
  value?: unknown;
}

// 挂上页面：真 `Config` 的 volatile 投影 + 替身的 settings 读写面。
// `user` 是用户层那份（字段"已覆盖"的判据是它有没有这个键）：清一个已覆盖的字段才会产生写。
function mounted(options: { user?: unknown; served?: boolean } = {}) {
  const form = volatileForm(Config as never) as z;
  const listeners = new Set<() => void>();
  const ops: PathOp[] = [];
  const mutate = vi.fn((next: readonly PathOp[]) => {
    ops.push(...next);
    return Promise.resolve(true);
  });
  const snapshot = {
    status: "ready",
    value: section,
    base: {},
    user: options.user,
    writable: true,
    revision: 1,
    mode: "host",
  };
  const face = createBundleConfigFace(
    {
      configForms: {
        get: () => ({
          getSnapshot: () => snapshot,
          subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          mutate,
          set: () => Promise.resolve(true),
          unset: () => Promise.resolve(true),
        }),
        describe: () => ({
          getSnapshot: () => ({
            status: "ready",
            view: {
              namespaces:
                options.served === false
                  ? []
                  : [
                      {
                        ns: "session-mode",
                        schema: form.toJSON(),
                        value: section,
                        autoGenerate: true,
                        applies: "live",
                        secrets: [],
                        revision: 1,
                      },
                    ],
              writable: true,
              hasDocument: false,
            },
            error: null,
          }),
          subscribe: () => () => {},
          ensure: () => Promise.resolve(),
          acceptView: () => {},
        }),
      },
      settingsSchema: { rehydrate: (serialized: unknown) => new z(serialized as never) },
      locale: { bind: () => t },
      get: () => undefined,
    } as never,
    t,
  ).face;
  const view = (): ReturnType<typeof projectBundleConfig> =>
    projectBundleConfig(face.hooks.bundleConfig.getSnapshot(), t);
  return { face, view, ops, mutate };
}

describe("bundle 配置页：视图", () => {
  it("模式清单折成卡片：id、标题、角色与摘要都在，`noop` 不给删", () => {
    const cards = mounted().view().modes;

    expect(cards.map((card) => card.id)).toEqual(["coding", "chat", "noop"]);
    expect(cards.map((card) => card.title)).toEqual(["编码模式", "对话模式", "原样模式"]);
    expect(cards[0]?.role).toEqual(["main", "subagent"]);
    // 摘要：工具面 + 模型面（`coding` 不收窄、只禁一件；三个模式都没配默认模型）。
    expect(cards[0]?.summary).toBe("summary.denyTools(1) · summary.globalModel");
    expect(cards[1]?.summary).toBe("summary.tools(1) · summary.globalModel");
    expect(cards[0]?.deletable).toBe(true);
    expect(cards[2]?.deletable).toBe(false);
  });

  it("默认模式的选项就是模式清单（值 = id，显示名 = 模式名），当前值照实显示", () => {
    const selected = mounted().view().defaultMode;

    expect(selected.value).toBe("coding");
    expect(selected.options).toEqual([
      { value: "coding", label: "编码模式" },
      { value: "chat", label: "对话模式" },
      { value: "noop", label: "原样模式" },
    ]);
    expect(selected.invalid).toBeUndefined();
  });

  it("字段按分组摆：每个模式都有六组，名单字段给出当前项", () => {
    const card = mounted().view().modes[0];

    expect(card?.groups.map((group) => group.key)).toEqual([
      "identity",
      "persona",
      "tools",
      "rules",
      "injections",
      "model",
    ]);
    const tools = card?.groups.find((group) => group.key === "tools");
    const denied = tools?.fields.find((field) => field.path.join(".") === "modes.coding.denyTools");
    expect(denied?.value).toEqual(["load_workspace_dependencies"]);
    // 没配的 `skills` 是三态里的"不写"：按工具名单推导，页面上不等于关。
    const skills = card?.groups
      .find((group) => group.key === "injections")
      ?.fields.find((field) => field.path.join(".") === "modes.coding.skills");
    expect(skills?.value).toBe("unset");
  });
});

describe("bundle 配置页：读这一行配置的阶段", () => {
  it("设置面送到了：页面就绪", () => {
    expect(mounted().view().readiness).toBe("ready");
  });

  it("读不出来与没在跑分开说：还没送到 / 没有这个命名空间 / schema 读不出来", () => {
    const { face } = mounted({ served: false });
    const snapshot = face.hooks.bundleConfig.getSnapshot();

    // 设置面还没送到。
    expect(projectBundleConfig(snapshot, t, "loading").readiness).toBe("loading");
    // 送到了但没有这一行。
    expect(projectBundleConfig(snapshot, t, "unavailable").readiness).toBe("missing");
    // 命名空间在，schema 却渲染不出来（行在跑，是配置面自己的问题）。
    expect(projectBundleConfig(snapshot, t, "ready").readiness).toBe("unreadable");
  });

  it("诊断读数：说出设置面现在有哪些命名空间、这一行卡在哪", () => {
    const served = mounted();
    expect(served.face.diagnose().problem).toBe("renderable");

    const absent = mounted({ served: false });
    const diagnosis = absent.face.diagnose();
    expect(diagnosis.namespaces).toEqual([]);
    expect(diagnosis.problem).toContain("session-mode");
  });
});

describe("bundle 配置页：名单的解析", () => {
  it("粘贴的一串按逗号（中英）/ 分号 / 换行拆开：去空白、去重、保序", () => {
    expect(parseTagList("read, write；bash\nls")).toEqual(["read", "write", "bash", "ls"]);
    expect(parseTagList(" read ,,read ; read ")).toEqual(["read"]);
    expect(parseTagList("   ")).toEqual([]);
  });

  it("并进现有标签：重复的不再进来，现有的保持在前", () => {
    expect(mergeTags(["read"], ["write", "read"])).toEqual(["read", "write"]);
    expect(mergeTags([], ["bash"])).toEqual(["bash"]);
  });
});

describe("bundle 配置页：动作", () => {
  it("添加模式：加一个字典键，并把名称默认成它的 id", () => {
    const { face, view } = mounted();
    face.addMode("draft");

    const card = view().modes.find((mode) => mode.id === "draft");
    expect(card).toBeDefined();
    expect(card?.title).toBe("draft");
    expect(card?.staged).toBe(true);
  });

  it("删除模式：受保护的模式调用是空操作，其余走字典的删除", () => {
    const { face, view } = mounted();
    face.removeMode("noop");
    expect(view().modes.map((mode) => mode.id)).toContain("noop");

    face.removeMode("chat");
    expect(view().modes.map((mode) => mode.id)).toEqual(["coding", "noop"]);
  });

  it("保存：编辑先落草稿，一次写出全部改动", async () => {
    const { face, ops, mutate } = mounted();
    face.editText(["modes", "coding", "name"], "编码模式（改）");
    face.set(["default"], "chat");
    face.editText(["modes", "coding", "denyTools", "0"], "read");

    face.save();
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(ops).toEqual([
      { op: "set", path: ["modes", "coding", "name"], value: "编码模式（改）" },
      { op: "set", path: ["default"], value: "chat" },
      { op: "set", path: ["modes", "coding", "denyTools", "0"], value: "read" },
    ]);
  });

  it("默认模式不在清单里：保存被整段校验挡下，页面上就地说明", async () => {
    const { face, mutate, view } = mounted();
    face.removeMode("coding");
    face.save();
    await Promise.resolve();
    expect(mutate).not.toHaveBeenCalled();
    expect(view().violation).toBe("violation.defaultMissing");
    expect(view().defaultMode.invalid).toBe("violation.defaultMissing");
  });

  it("默认模型只给一半：保存被挡下（与 host 装配期同一条判据）", async () => {
    const { face, mutate, view } = mounted();
    face.set(["modes", "chat", "defaultModel"], { provider: "deepseek-account", model: "" });
    face.save();
    await Promise.resolve();
    expect(mutate).not.toHaveBeenCalled();
    expect(view().violation).toBe("violation.modelPair");
  });

  it("清掉已覆盖的默认模型：回到跟随全局（写一个 unset）", async () => {
    const { face, ops, mutate } = mounted({
      user: { modes: { chat: { defaultModel: { provider: "deepseek-account", model: "flash" } } } },
    });
    face.clear(["modes", "chat", "defaultModel"]);
    face.save();
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(ops).toEqual([{ op: "unset", path: ["modes", "chat", "defaultModel"] }]);
  });
});

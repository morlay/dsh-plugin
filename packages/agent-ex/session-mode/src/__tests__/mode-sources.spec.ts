// 内置默认模式（`{dshHome}/modes/*.toml` 缺省时的那三份）的会话级扩展：名单、开关与 policy 拦截。
// 这些事实原本由 bundle 的 `patch.spec.ts` 断言行 config——模式定义收敛到 TOML 之后，行 config 只带 `default`，
// 判据搬到这里（能力的 home 在能力包）。
import { describe, expect, it } from "vitest";
import { MODE_SOURCES } from "@morlay/session-mode";

function sourceOf(id: string) {
  const source = MODE_SOURCES.find((entry) => entry.id === id);
  if (source === undefined) throw new Error(`内置默认里没有 ${id}`);
  return source;
}

describe("内置默认模式", () => {
  it("三个模式：coding / chat / noop；三个都不限制 preset", () => {
    expect(MODE_SOURCES.map((source) => source.id)).toEqual(["coding", "chat", "noop"]);
    for (const source of MODE_SOURCES) expect(source.presetsOnly, source.id).toBeUndefined();
  });

  it("coding 用全部工具，只排除官方 Office 载荷查询与插件管理；技能面按名排除三件", () => {
    const coding = sourceOf("coding");

    expect(coding.allowTools).toBeUndefined();
    expect(coding.denyTools).toEqual(["load_workspace_dependencies", "plugin_manager"]);
    expect(coding.allowSkills).toBeUndefined();
    expect(coding.denySkills).toEqual(["office-docx", "office-pptx", "office-xlsx"]);
  });

  it("coding 禁掉上游的「先读后改」与写路径的意图判定", () => {
    const coding = sourceOf("coding");

    expect(coding.denyPolicies).toEqual(["fs/edit-intent", "fs/write-intent"]);
    expect(coding.allowPolicies).toBeUndefined();
  });

  it("chat 只收提问 + 联网三件，一条 policy 都不禁，注入面全关", () => {
    const chat = sourceOf("chat");

    expect(chat.allowTools).toEqual(["ask_user_question", "web_search", "web_fetch"]);
    expect(chat.denyTools).toBeUndefined();
    expect(chat.denyPolicies).toBeUndefined();
    expect(chat.allowPolicies).toBeUndefined();
    expect(chat.instructions).toBe(false);
    expect(chat.runtimeContext).toBe(false);
    expect(chat.role).toEqual(["main"]);
  });

  it("noop 什么都不配：名单全留空，装配结果与没有模式一致", () => {
    const noop = sourceOf("noop");

    expect(noop).toMatchObject({ name: "原样模式", role: ["main", "subagent"] });
    expect(noop.allowTools).toBeUndefined();
    expect(noop.denyTools).toBeUndefined();
    expect(noop.allowSkills).toBeUndefined();
    expect(noop.denySkills).toBeUndefined();
    expect(noop.allowPolicies).toBeUndefined();
    expect(noop.denyPolicies).toBeUndefined();
  });
});

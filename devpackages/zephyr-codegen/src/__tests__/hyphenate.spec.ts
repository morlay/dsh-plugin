import { describe, expect, it } from "vitest";
import { hyphenate, tokenNameOf } from "../hyphenate.ts";

describe("行 id 由 token 名派生", () => {
  it("类名的大写边界转 hyphen", () => {
    expect(hyphenate("WebSearchOllama")).toBe("web-search-ollama");
    expect(hyphenate("SandboxLocal")).toBe("sandbox-local");
    expect(hyphenate("SessionRdb")).toBe("session-rdb");
    expect(hyphenate("SessionRDB")).toBe("session-rdb");
    expect(hyphenate("HTTPClient")).toBe("http-client");
    expect(hyphenate("UiConversationMessageActions")).toBe("ui-conversation-message-actions");
    expect(hyphenate("Reference")).toBe("reference");
  });

  it("下划线、连字符与数字按同一规则折叠", () => {
    expect(hyphenate("Foo_Bar")).toBe("foo-bar");
    expect(hyphenate("Foo--Bar")).toBe("foo-bar");
    expect(hyphenate("V2Client")).toBe("v2-client");
  });

  it("适配类优先用 providerName（上游插件名）", () => {
    class Adapted {}
    Object.defineProperty(Adapted, "providerName", { value: "session-query-sqlite" });
    expect(tokenNameOf(Adapted)).toBe("session-query-sqlite");
  });

  it("没有类名就报错", () => {
    const nameless = () => {};
    Object.defineProperty(nameless, "name", { value: "" });
    expect(() => tokenNameOf(nameless)).toThrow(/no class name/);
  });
});

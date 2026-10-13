import { describe, expect, it } from "vitest";
import { nodeInspectorDevtoolsUrl } from "../developer-endpoint.ts";

describe("后端调试前端地址", () => {
  it("把 host 回报的端点拼成应用 origin 下的 DevTools 入口", () => {
    expect(nodeInspectorDevtoolsUrl("dsh-custom-next", "ws://127.0.0.1:9229/7f0d-4a2b")).toBe(
      "dsh-custom-next://app/node-devtools/devtools_app.html" +
        "?ws=127.0.0.1:9229/7f0d-4a2b&panel=console&disableLocaleInfoBar=true",
    );
  });

  it("非 WebSocket 端点与带查询分隔符的端点都拒绝", () => {
    expect(() => nodeInspectorDevtoolsUrl("dsh-app", "http://127.0.0.1:9229/x")).toThrow();
    expect(() => nodeInspectorDevtoolsUrl("dsh-app", "ws://127.0.0.1:9229/x?y=1&z=2")).toThrow();
    expect(() => nodeInspectorDevtoolsUrl("dsh-app", "not a url")).toThrow();
  });
});

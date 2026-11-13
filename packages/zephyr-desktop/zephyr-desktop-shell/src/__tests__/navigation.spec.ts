import { describe, expect, it } from "vitest";
import { navigationPlanOf } from "../navigation.ts";

const ORIGIN = "http://127.0.0.1:3080";

describe("导航判据（页面来自壳自己的 http 源）", () => {
  it("本源放行：页面、资源、相对路径", () => {
    for (const target of [
      "http://127.0.0.1:3080/",
      "http://127.0.0.1:3080/index.html",
      "http://127.0.0.1:3080/@vite/client",
      "assets/main.js",
      "/plugins/x.js",
    ]) {
      expect(navigationPlanOf(target, ORIGIN)).toEqual({ kind: "allow" });
    }
  });

  it("http(s) 与 mailto 交系统浏览器", () => {
    expect(navigationPlanOf("https://example.com/a?b=1", ORIGIN)).toEqual({
      kind: "external",
      url: "https://example.com/a?b=1",
    });
    expect(navigationPlanOf("mailto:dev@example.com", ORIGIN)).toEqual({
      kind: "external",
      url: "mailto:dev@example.com",
    });
    expect(navigationPlanOf("http://127.0.0.1:9/elsewhere", ORIGIN)).toEqual({
      kind: "external",
      url: "http://127.0.0.1:9/elsewhere",
    });
  });

  it("其它 scheme 一律拒：file / javascript / data / 陌生的自定义 scheme", () => {
    for (const target of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "zephyr://app/index.html",
    ]) {
      expect(navigationPlanOf(target, ORIGIN)).toEqual({ kind: "deny" });
    }
  });

  it('解析不出来的目标也拒（不给 "什么都没发生" 留口子）', () => {
    expect(navigationPlanOf("http://", ORIGIN)).toEqual({ kind: "deny" });
  });
});

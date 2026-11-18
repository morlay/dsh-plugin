// 失败面折过之后**必须还能读**：上游消费面按 `String(error)` 兜底，折成普通对象就只剩
// `[object Object]`——真错误（终端那条 `posix_openpt failed`）会被整条藏住。
import { describe, expect, it } from "vitest";
import { asRemoteResult, failureOf } from "../remote-result.ts";

describe("failureOf", () => {
  it("折过的失败面 `String()` 出来是真因，不是 [object Object]", () => {
    const failure = failureOf(new Error("posix_openpt failed: Operation not permitted"));
    expect(String(failure)).toContain("posix_openpt failed");
    expect(String(failure), "带 code 才好定位是哪一类失败").toContain("gateway/invoke-failed");
    expect(failure.message, "结构化字段照旧").toBe("posix_openpt failed: Operation not permitted");
  });

  it("结构化字段能带上上游的 code / details", () => {
    const failure = failureOf(
      Object.assign(new Error("boom"), { code: "terminal/open-failed", details: { pty: true } }),
    );
    expect(failure.code).toBe("terminal/open-failed");
    expect(failure.details).toEqual({ pty: true });
    expect(String(failure)).toBe("terminal/open-failed: boom");
  });

  it("不是 Error 的抛出值也照样可读（`String()` 有内容，不是空串）", () => {
    const failure = failureOf("plain-string-failure");
    expect(failure.message).toBe("plain-string-failure");
    expect(String(failure)).toContain("plain-string-failure");
  });

  it("`toString` 不进 JSON：wire 上仍然只有三个字段", () => {
    const failure = failureOf(new Error("x"));
    expect(Object.keys(failure).sort()).toEqual(["code", "details", "message"]);
    expect(JSON.parse(JSON.stringify(failure))).toEqual({
      code: "gateway/invoke-failed",
      message: "x",
      details: {},
    });
    // `toString` 是原型链上的（`Object.prototype`），所以判「自有键」而不是 `in`。
    expect(Object.hasOwn(JSON.parse(JSON.stringify(failure)), "toString")).toBe(false);
  });

  it("`asRemoteResult` 折出来的失败面同样可读", async () => {
    const result = await asRemoteResult(async () => {
      throw new Error("posix_openpt failed");
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(String(result.error)).toContain("posix_openpt failed");
  });
});

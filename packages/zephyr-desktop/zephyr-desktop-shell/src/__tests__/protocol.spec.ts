import { describe, expect, it } from "vitest";
import { isInside, mimeOf, resourcePathOf } from "../protocol.ts";

describe("自定义协议", () => {
  it("把 zephyr:// 与裸路径都归一成产物目录里的文件", () => {
    expect(resourcePathOf("zephyr://app/index.html", "/out")).toBe("/out/index.html");
    expect(resourcePathOf("zephyr://app/assets/main.js", "/out")).toBe("/out/assets/main.js");
    expect(resourcePathOf("/assets/main.js", "/out")).toBe("/out/assets/main.js");
    expect(resourcePathOf("zephyr://app/", "/out")).toBe("/out/index.html");
  });

  it("越界的尝试被夹回产物根内（URL 规范化 + 落点校验）", () => {
    for (const attempt of [
      "zephyr://app/../../etc/passwd",
      "zephyr://app/%2e%2e/%2e%2e/etc/passwd",
      "/a/../../b",
    ]) {
      const resolved = resourcePathOf(attempt, "/out");
      expect(resolved === undefined || isInside(resolved, "/out")).toBe(true);
    }
  });

  it("扩展名决定 content-type", () => {
    expect(mimeOf("/out/index.html")).toContain("text/html");
    expect(mimeOf("/out/main.mjs")).toContain("text/javascript");
    expect(mimeOf("/out/x.bin")).toBe("application/octet-stream");
  });

  it("越界判据按目录前缀，不按字符串前缀", () => {
    expect(isInside("/out/assets/a.js", "/out")).toBe(true);
    expect(isInside("/out", "/out")).toBe(true);
    expect(isInside("/outside/a.js", "/out")).toBe(false);
  });
});

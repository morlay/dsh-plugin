import { describe, expect, it } from "vitest";
import { parseFederationUrl } from "@morlay/zephyr-app/testing";

describe("parseFederationUrl", () => {
  it("解析 scope 包与版本（scope 的 @ 在前，版本分隔在后）", () => {
    expect(
      parseFederationUrl("/_zephyr/@modules/@deepseek-ai+zephyr-ui@0.0.1/index.js?v=abc"),
    ).toEqual({ name: "@deepseek-ai/zephyr-ui", urlVersion: "0.0.1", file: "index.js" });
  });

  it("解析普通包与子路径", () => {
    expect(parseFederationUrl("/_zephyr/@modules/react@18.3.1/jsx-runtime.js")).toEqual({
      name: "react",
      urlVersion: "18.3.1",
      file: "jsx-runtime.js",
    });
  });

  it("不是这条链的地址返回 undefined", () => {
    expect(parseFederationUrl("/@vite/client")).toBeUndefined();
    expect(parseFederationUrl("/_zephyr/@modules/nope")).toBeUndefined();
  });
});

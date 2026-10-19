import inspector from "node:inspector";
import { afterEach, describe, expect, it } from "vitest";
import { applyInspectorCommand, closeInspectorEndpoint } from "../inspector.ts";

afterEach(() => {
  closeInspectorEndpoint();
});

describe("调试端点开关", () => {
  it("开在回环的随机端口上并回报端点，关掉后端点消失", () => {
    const event = applyInspectorCommand({ type: "inspect", port: 0 });
    expect(event?.type).toBe("inspected");
    const url = event?.url ?? "";
    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/u);
    expect(url).not.toContain(":0/");
    expect(inspector.url()).toBe(url);

    expect(applyInspectorCommand({ type: "inspect-off" })).toEqual({
      type: "inspected",
      url: null,
    });
    expect(inspector.url()).toBeUndefined();
  });

  it("已有端点时复用而不是换端口（dev 的 --inspect 启动参数占着的那个）", () => {
    const first = applyInspectorCommand({ type: "inspect", port: 0 });
    const second = applyInspectorCommand({ type: "inspect", port: 0 });
    expect(second).toEqual(first);
    expect(inspector.url()).toBe(first?.url);
  });

  it("端口非法时报原因而不是抛出", () => {
    const event = applyInspectorCommand({ type: "inspect", port: 65_536 });
    expect(event?.type).toBe("inspected");
    expect(event?.url).toBeNull();
    expect(event?.message).toBeTruthy();
  });

  it("重复关闭是幂等的，非调试命令不回应", () => {
    expect(applyInspectorCommand({ type: "inspect-off" })).toEqual({
      type: "inspected",
      url: null,
    });
    expect(applyInspectorCommand({ type: "inspect-off" })).toEqual({
      type: "inspected",
      url: null,
    });
    expect(applyInspectorCommand({ type: "shutdown" })).toBeUndefined();
  });
});

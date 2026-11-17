import { afterEach, describe, expect, it, vi } from "vitest";
import { shellDebugOf } from "../debug.ts";

const writes: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  writes.length = 0;
});

/**
 * 拦 stderr，收集壳打出来的行。
 * @returns 收集函数。
 */
function captureStderr(): () => string {
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  return () => writes.join("");
}

describe("壳的调试面（开发者模式的只读投影）", () => {
  it("关着时 log / renderer 静默，fail 照样输出（错误不该被开关吞掉）", () => {
    const read = captureStderr();
    const debug = shellDebugOf({ enabled: false });
    expect(debug.enabled).toBe(false);
    debug.log("生命周期");
    debug.renderer("渲染进程");
    expect(read()).toBe("");
    debug.fail("启动失败");
    expect(read()).toContain("启动失败");
  });

  it("打开时三类都带各自前缀", () => {
    const read = captureStderr();
    const debug = shellDebugOf({ enabled: true });
    expect(debug.enabled).toBe(true);
    debug.log("已加载 http://127.0.0.1:3080/");
    debug.renderer("[vite] connected.");
    expect(read()).toContain("[shell] 已加载");
    expect(read()).toContain("[renderer] [vite] connected.");
  });

  it("跟着来源走：来源一转，投影立刻改口（不重建就能生效）", () => {
    const read = captureStderr();
    const source = { enabled: false };
    const debug = shellDebugOf(source);
    debug.log("开之前");
    source.enabled = true;
    debug.log("开之后");
    source.enabled = false;
    debug.log("又关掉");
    expect(read()).toContain("开之后");
    expect(read()).not.toContain("开之前");
    // 关掉之后立刻又安静（同一个投影，没有第二份状态）。
    expect(read()).not.toContain("又关掉");
  });
});

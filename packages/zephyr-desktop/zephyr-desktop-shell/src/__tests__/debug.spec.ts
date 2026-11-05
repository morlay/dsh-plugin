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

describe("壳的调试面", () => {
  it("只有 ZEPHYR_DESKTOP_DEBUG=1 才打开", () => {
    expect(shellDebugOf({}).enabled).toBe(false);
    expect(shellDebugOf({ ZEPHYR_DESKTOP_DEBUG: "0" }).enabled).toBe(false);
    expect(shellDebugOf({ ZEPHYR_DESKTOP_DEBUG: "1" }).enabled).toBe(true);
  });

  it("关着时 log / renderer 静默，fail 照样输出（错误不该被开关吞掉）", () => {
    const read = captureStderr();
    const debug = shellDebugOf({});
    debug.log("生命周期");
    debug.renderer("渲染进程");
    expect(read()).toBe("");
    debug.fail("启动失败");
    expect(read()).toContain("启动失败");
  });

  it("打开时三类都带各自前缀", () => {
    const read = captureStderr();
    const debug = shellDebugOf({ ZEPHYR_DESKTOP_DEBUG: "1" });
    debug.log("已加载 http://127.0.0.1:3080/");
    debug.renderer("[vite] connected.");
    expect(read()).toContain("[shell] 已加载");
    expect(read()).toContain("[renderer] [vite] connected.");
  });
});

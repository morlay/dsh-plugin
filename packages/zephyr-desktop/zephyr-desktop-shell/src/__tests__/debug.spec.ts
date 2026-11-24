import { describe, expect, test } from "@morlay/zephyr/testing";
import { vi } from "vitest";
import { shellDebugOf } from "../debug.ts";

/**
 * 拦 stderr，收集壳打出来的行。
 *
 * 收集容器是**调用方自己的数组**（不再是模块级变量）：每条用例一份，不需要 afterEach 清空。
 * vi.spyOn 的还原交给包级 stubRestore auto fixture。
 * @param writes - 收集容器的数组。
 * @returns 读取函数。
 */
function captureStderr(writes: string[]): () => string {
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  return () => writes.join("");
}

describe("壳的调试面（开发者模式的只读投影）", () => {
  test("关着时 log / renderer 静默，fail 照样输出（错误不该被开关吞掉）", () => {
    const writes: string[] = [];
    const read = captureStderr(writes);
    const debug = shellDebugOf({ enabled: false });
    expect(debug.enabled).toBe(false);
    debug.log("生命周期");
    debug.renderer("渲染进程");
    expect(read()).toBe("");
    debug.fail("启动失败");
    expect(read()).toContain("启动失败");
  });

  test("打开时三类都带各自前缀", () => {
    const writes: string[] = [];
    const read = captureStderr(writes);
    const debug = shellDebugOf({ enabled: true });
    expect(debug.enabled).toBe(true);
    debug.log("已加载 http://127.0.0.1:3080/");
    debug.renderer("[vite] connected.");
    expect(read()).toContain("[shell] 已加载");
    expect(read()).toContain("[renderer] [vite] connected.");
  });

  test("跟着来源走：来源一转，投影立刻改口（不重建就能生效）", () => {
    const writes: string[] = [];
    const read = captureStderr(writes);
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

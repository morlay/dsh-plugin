// 日志出口的两条判据：级别决定是否附栈、环境开关能关掉它。
//
// 附栈是为了排查被吞掉的失败（监听器抛错只剩一句 message），所以判据落在**输出文本**上。
import { describe, expect, test } from "@morlay/zephyr/testing";
import { logLineOf } from "../logger-exporter.service.ts";

describe("日志出口", () => {
  test("info / debug 不带栈", () => {
    expect(logLineOf(["装配完成 %s", "ok"], 2)).toBe("装配完成 ok");
    expect(logLineOf(["调试"], 3)).toBe("调试");
  });

  test("警告与错误带调用栈（每一帧一行缩进）", () => {
    const line = logLineOf(['agent "x": 监听器抛错'], 1);
    expect(line.startsWith('agent "x": 监听器抛错\n')).toBe(true);
    expect(line).toContain("at ");
  });

  test("开关关掉时连警告也不带栈", () => {
    expect(logLineOf(["只是警告"], 1, false)).toBe("只是警告");
  });
});

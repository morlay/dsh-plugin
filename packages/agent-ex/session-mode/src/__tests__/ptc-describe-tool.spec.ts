// PTC 装配下模型面的唯一入口是 `run_code`：其余工具都要在程序里通过 `tools.<name>()` 调，
// 而"有哪些工具、签名是什么"靠 `tools.describe_tool({ group })` 现取。
//
// 所以 `describe_tool` **必须由我们注册成真工具**——骨架里承诺了它，没注册的话模型在程序里
// 调它会得到 `unknown tool`（真机上表现为"取不到签名，只能瞎猜参数"）。
import { describe, expect, it } from "vitest";
import { describeTools, groupEntries } from "@morlay/session-mode";

describe("describe_tool 的契约", () => {
  it("按组归并（MCP 一个 server 一组）", () => {
    const groups = groupEntries([
      { name: "read", description: "读文件" },
      { name: "bash", description: "执行命令" },
      { name: "mcp__agent-browser__open", description: "开网页" },
    ]);
    expect([...groups.keys()].sort()).toEqual(["fs", "mcp:agent-browser", "shell"]);
  });

  it("不带 group 给分组清单，带 group 给该组签名", () => {
    const entries = [
      { name: "read", description: "读文件" },
      { name: "write", description: "写文件" },
    ];
    expect(describeTools(entries)).toContain("fs — 文件读写");
    const text = describeTools(entries, "fs");
    // 同组的工具一起返回（按名字排序）。
    expect(text).toContain("read(args:");
    expect(text).toContain("write(args:");
  });

  it("未知 group 给空串（不是抛错）", () => {
    expect(describeTools([{ name: "read", description: "读" }], "nope")).toBe("");
  });
});

// 代码执行通道：PTC 模式下用程序调用其它工具。
import type { ToolPack } from "../types.ts";

export const CODE_PACK: ToolPack = {
  family: "code",
  tools: [{ tool: "run_code", short: "用代码调用其它工具（PTC）" }],
};

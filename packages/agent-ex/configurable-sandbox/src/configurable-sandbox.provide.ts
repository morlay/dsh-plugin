import { provide } from "@morlay/zephyr";
import { ConfigurableFsSandbox } from "./fs.service.ts";
import { SandboxRuntimeContexts } from "./runtime-contexts.service.ts";
import { ConfigurableSandbox } from "./sandbox.service.ts";
import { SandboxFileDefault } from "./sandbox-file.service.ts";
import { SandboxRulesDefault } from "./sandbox-rules.service.ts";

// 顺序有依赖：读配置 → 解析规则 → 两个替换实现 → 接管运行时文本（最后一步要规则与策略都就绪）。
export const provideConfigurableSandbox = provide([
  SandboxFileDefault,
  SandboxRulesDefault,
  ConfigurableSandbox,
  ConfigurableFsSandbox,
  SandboxRuntimeContexts,
]);

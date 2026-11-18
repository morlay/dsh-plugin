import { provide } from "@morlay/zephyr";
import { PtcRuntimeDefault } from "./ptc-runtime.service.ts";
import { ToolExecutorPtc } from "./tool-executor.service.ts";

/**
 * PTC 的两件事：运行时（`ptcRuntime`，跑程序的那台机器）与执行器（把模型面收成 `run_code` 的那一行）。
 *
 * 两者缺一不可：只有运行时，模型面照旧是普通工具清单（执行器才是"选 PTC"这件事的拥有者）；
 * 只有执行器，`run_code` 一跑就抛 "requires a PTC runtime"。
 *
 * 装配位置**这一票不动**（仍在应用根）：按 scope 装配（`@AgentScoped()`）要连着上游
 * `setExecutor` 的互斥语义一起量，见设计记录的「迁移面」。
 */
export const providePtc = provide([PtcRuntimeDefault, ToolExecutorPtc]);

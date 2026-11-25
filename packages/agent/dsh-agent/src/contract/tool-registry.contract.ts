// 工具注册表契约：令牌按服务语义命名（上游注册名 `tools`）。
import type ToolRuntime from "@deepseek-ai/dsh-tools";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

// 能力词汇：一条工具定义（注册进注册表的东西）与它到模型 schema 的投影。
/** 一条工具定义：名字、描述、参数 schema 与处理函数。 */
export type { ToolDefinition } from "@deepseek-ai/dsh-tools";
/** 把工具定义投影成模型看到的 schema（纯函数）。 */
export { projectToolSchema } from "@deepseek-ai/dsh-tools";

@Injectable({ name: "tools" })
export abstract class ToolRegistry {
  abstract readonly register: ToolRuntime["register"];

  abstract readonly restrict: ToolRuntime["restrict"];

  abstract readonly guard: ToolRuntime["guard"];

  abstract readonly get: ToolRuntime["get"];

  abstract readonly schemas: ToolRuntime["schemas"];

  abstract readonly execute: ToolRuntime["execute"];

  abstract readonly checkGuards: ToolRuntime["checkGuards"];

  abstract readonly definitions: ToolRuntime["definitions"];

  abstract readonly executable: ToolRuntime["executable"];

  abstract readonly resolve: ToolRuntime["resolve"];

  abstract readonly setExecutor: ToolRuntime["setExecutor"];
}

/**
 * 覆盖守卫（严格）：上游 `ToolRuntime` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type ToolRegistryCovered = AssertTrue<AssertCoveredStrict<ToolRuntime, ToolRegistry>>;

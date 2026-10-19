// 工具注册表契约：令牌按服务语义命名（上游注册名 `tools`）。
import type ToolRuntime from "@deepseek-ai/dsh-tools";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `ToolRuntime` 的**全部**公开成员。
 *
 * `execute` 是「一次真实执行」的入口：消费方（例如 shell 的行）需要执行上下文时走它，
 * 执行会派发 `tools/execute`，包装器从事件里拿到的那份 `ToolExecution` 就是运行时真值。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type ToolRegistryCovered = AssertTrue<AssertCovered<ToolRuntime, ToolRegistry>>;

@Injectable()
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

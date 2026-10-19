// subagent 运行时契约：令牌按服务语义命名（上游注册名 `subagents`）。
import type { SubagentRuntime } from "@morlay/dsh-subagent/server";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SubagentRuntime` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.subagents.<member>` 取用（`tool-subagent` 的 `spawn` / `fork` 都读它），
 * 缺一个那条插件在运行期读到的就是 `undefined`；下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SubagentsCovered = AssertTrue<AssertCovered<SubagentRuntime, SubagentRegistry>>;

@Injectable()
export abstract class SubagentRegistry {
  abstract readonly resolveMaxDepth: SubagentRuntime["resolveMaxDepth"];

  abstract readonly startActivation: SubagentRuntime["startActivation"];

  abstract readonly drainChildren: SubagentRuntime["drainChildren"];

  abstract readonly drainDescendants: SubagentRuntime["drainDescendants"];

  abstract readonly getProvider: SubagentRuntime["getProvider"];

  abstract readonly interrupt: SubagentRuntime["interrupt"];

  abstract readonly interruptByParent: SubagentRuntime["interruptByParent"];

  abstract readonly list: SubagentRuntime["list"];

  abstract readonly listChildren: SubagentRuntime["listChildren"];

  abstract readonly listDescendants: SubagentRuntime["listDescendants"];

  abstract readonly prompt: SubagentRuntime["prompt"];

  abstract readonly registerProvider: SubagentRuntime["registerProvider"];

  abstract readonly sendMessage: SubagentRuntime["sendMessage"];

  abstract readonly typertRemote: SubagentRuntime["typertRemote"];

  abstract readonly waitForChildren: SubagentRuntime["waitForChildren"];
}


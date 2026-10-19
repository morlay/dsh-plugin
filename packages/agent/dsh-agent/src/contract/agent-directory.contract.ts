// agent 注册表契约：令牌按服务语义命名（上游注册名 `agents`）。
//
// 签名面向**使用方**，但标识用 `SessionId` 品牌而不是裸 `string`：品牌在**边界**转换一次
// （`endpoint/` 收 wire 上的字符串，转成 `SessionId` 后进入内部），里面就都是同一个类型。
import type { AgentRegistry as AgentRegistryService } from "@deepseek-ai/dsh-agent";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `AgentRegistry` 的**全部**公开成员。
 *
 * 成员一个都不能少——上游插件按 `ctx.agents.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 * `get` / `list` 用**方法**声明：子类（含测试替身）按方法实现，属性与方法的声明形式不同就不能互相覆盖。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type AgentDirectoryCovered = AssertTrue<AssertCovered<AgentRegistryService, AgentDirectory>>;

@Injectable()
export abstract class AgentDirectory {
  abstract readonly currentInitiator: AgentRegistryService["currentInitiator"];

  abstract readonly requireInitiator: AgentRegistryService["requireInitiator"];

  abstract readonly withInitiator: AgentRegistryService["withInitiator"];

  abstract readonly withoutInitiator: AgentRegistryService["withoutInitiator"];

  abstract readonly setFactory: AgentRegistryService["setFactory"];

  abstract readonly create: AgentRegistryService["create"];

  abstract readonly resume: AgentRegistryService["resume"];

  abstract readonly register: AgentRegistryService["register"];

  abstract readonly enter: AgentRegistryService["enter"];

  abstract readonly announce: AgentRegistryService["announce"];

  abstract readonly isOwnedBy: AgentRegistryService["isOwnedBy"];

  abstract readonly roots: AgentRegistryService["roots"];

  abstract get(id: Parameters<AgentRegistryService["get"]>[0]): ReturnType<AgentRegistryService["get"]>;

  abstract list(): ReturnType<AgentRegistryService["list"]>;

  abstract readonly turnBoundaryOf: AgentRegistryService["turnBoundaryOf"];
}

// agent 注册表契约：令牌按服务语义命名（上游注册名 `agents`）。
//
// 签名面向**使用方**，但标识用 `SessionId` 品牌而不是裸 `string`：品牌在**边界**转换一次
// （`endpoint/` 收 wire 上的字符串，转成 `SessionId` 后进入内部），里面就都是同一个类型。
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";
import { AgentRegistry as AgentRegistryService } from "@deepseek-ai/dsh-agent";

/** 能力词汇：一个活着的 agent 本身（会话 + inbox + 模型选择），注册表里存的就是它。 */
export type { Agent } from "@deepseek-ai/dsh-agent";

@Injectable({ name: "agents" })
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

  abstract get(
    id: Parameters<AgentRegistryService["get"]>[0],
  ): ReturnType<AgentRegistryService["get"]>;

  abstract list(): ReturnType<AgentRegistryService["list"]>;

  abstract readonly turnBoundaryOf: AgentRegistryService["turnBoundaryOf"];
}

/**
 * 覆盖守卫（严格）：上游 `AgentRegistryService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type AgentDirectoryCovered = AssertTrue<AssertCoveredStrict<AgentRegistryService, AgentDirectory>>;

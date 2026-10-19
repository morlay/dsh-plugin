// agent 循环契约：令牌按服务语义命名（上游注册名 `agentLoop`）。
import type AgentLoopService from "@deepseek-ai/dsh-agent-loop";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/** 契约面：上游 `AgentLoop` 的**全部**公开成员（`AgentFactory` 的实现面）。 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type AgentLoopCovered = AssertTrue<AssertCovered<AgentLoopService, AgentLoop>>;

@Injectable()
export abstract class AgentLoop {
  abstract readonly config: AgentLoopService["config"];

  abstract readonly create: AgentLoopService["create"];

  abstract readonly createAgent: AgentLoopService["createAgent"];

  abstract readonly resume: AgentLoopService["resume"];
}


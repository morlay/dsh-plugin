// agent loop 契约：令牌按服务语义命名（上游注册名 `agentLoop`）。
import type AgentLoopService from "@deepseek-ai/dsh-agent-loop";
import { Injectable } from "@morlay/zephyr";

interface AgentLoopFace {
  readonly create: AgentLoopService["create"];
}

@Injectable()
export abstract class AgentLoop implements AgentLoopFace {
  abstract readonly create: AgentLoopFace["create"];
}

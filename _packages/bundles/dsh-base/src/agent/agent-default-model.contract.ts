// 默认模型契约：令牌按服务语义命名。
import type AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import { Injectable } from "@morlay/zephyr";

interface AgentDefaultModelFace {
  readonly currentSelection: AgentDefaultModelConfig["currentSelection"];
}

@Injectable()
export abstract class AgentDefaultModel implements AgentDefaultModelFace {
  abstract readonly currentSelection: AgentDefaultModelFace["currentSelection"];
}

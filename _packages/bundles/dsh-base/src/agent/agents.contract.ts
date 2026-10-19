// agent 注册表契约：令牌按服务语义命名（上游注册名 `agents`）。
import type { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { Injectable } from "@morlay/zephyr";

interface AgentsFace {
  readonly get: AgentRegistry["get"];
  readonly create: AgentRegistry["create"];
  readonly resume: AgentRegistry["resume"];
  readonly list: AgentRegistry["list"];
}

@Injectable()
export abstract class Agents implements AgentsFace {
  abstract readonly get: AgentsFace["get"];

  abstract readonly create: AgentsFace["create"];

  abstract readonly resume: AgentsFace["resume"];

  abstract readonly list: AgentsFace["list"];
}

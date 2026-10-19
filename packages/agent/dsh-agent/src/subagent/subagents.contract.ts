// subagent 运行时契约：令牌按服务语义命名（上游注册名 `subagents`）。
import type { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import { Injectable } from "@morlay/zephyr";

interface SubagentsFace {
  readonly resolveMaxDepth: SubagentRuntime["resolveMaxDepth"];
  readonly startActivation: SubagentRuntime["startActivation"];
}

@Injectable()
export abstract class Subagents implements SubagentsFace {
  abstract readonly resolveMaxDepth: SubagentsFace["resolveMaxDepth"];

  abstract readonly startActivation: SubagentsFace["startActivation"];
}

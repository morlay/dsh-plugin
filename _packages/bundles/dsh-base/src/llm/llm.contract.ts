// LLM 运行时契约：令牌按服务语义命名（上游注册名 `llm`）。
import type { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { Injectable } from "@morlay/zephyr";

interface LlmFace {
  readonly registerAdapter: LlmRuntime["registerAdapter"];
  readonly listModels: LlmRuntime["listModels"];
}

@Injectable()
export abstract class Llm implements LlmFace {
  abstract readonly registerAdapter: LlmFace["registerAdapter"];

  abstract readonly listModels: LlmFace["listModels"];
}

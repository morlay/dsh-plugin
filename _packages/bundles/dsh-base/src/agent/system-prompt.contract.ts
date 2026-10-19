// 系统提示词契约：令牌按服务语义命名（上游注册名 `systemPrompt`）。
import type { SystemPrompt as SystemPromptService } from "@deepseek-ai/dsh-system-prompt";
import { Injectable } from "@morlay/zephyr";

interface SystemPromptFace {
  readonly assemble: SystemPromptService["assemble"];
}

@Injectable()
export abstract class SystemPrompt implements SystemPromptFace {
  abstract readonly assemble: SystemPromptFace["assemble"];
}

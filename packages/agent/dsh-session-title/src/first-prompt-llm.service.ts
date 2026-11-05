import * as SessionTitleLlmPlugin from "@deepseek-ai/dsh-session-title-first-prompt-llm";
import type { Config as SessionTitleLlmConfig } from "@deepseek-ai/dsh-session-title-first-prompt-llm";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { SessionTitle } from "./index.ts";

/** 默认配置：上游 Config 的几个执行控制都是必填（装配面用 `configure` 覆盖）。 */
const DEFAULT_CONFIG: SessionTitleLlmConfig = {
  targetWords: 5,
  targetCjkCharacters: 10,
  maxInputBytes: 4096,
  maxOutputTokens: 4096,
  timeoutMs: 60000,
};

@Injectable()
export class SessionTitleLlm extends fromCordis(SessionTitleLlmPlugin) {
  sessionTitle = inject(SessionTitle);

  llm = inject(Llm);

  sessions = inject(SessionStore);

  /** 行配置（清单条目的 `config`，`configure` 可覆盖）：基类已接住，缺省用本文件的 `DEFAULT_CONFIG`。 */
  private get rowOptions(): SessionTitleLlmConfig {
    return (this.rowConfig ?? DEFAULT_CONFIG) as SessionTitleLlmConfig;
  }

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, this.rowOptions, {
      sessionTitle: this.sessionTitle,
      llm: this.llm,
      sessions: this.sessions,
    });
  }
}

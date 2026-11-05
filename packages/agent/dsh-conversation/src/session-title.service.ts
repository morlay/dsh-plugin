import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjectionStore } from "@morlay/dsh-session";
import SessionTitleService, {
  type Config as SessionTitleConfig,
} from "@deepseek-ai/dsh-session-title";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionTitle } from "./contract/session-title.contract.ts";

/** 默认预算：字数、字节与最终标题上限（装配面用 `configure` 覆盖）。 */
const DEFAULT_CONFIG: SessionTitleConfig = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 80,
};

@Injectable()
export class SessionTitleDefault extends fromCordis(SessionTitle, SessionTitleService) {
  sessions = inject(SessionStore);

  sessionProjections = inject(SessionProjectionStore);

  agents = inject(AgentDirectory);

  /** 行配置（清单条目的 `config`，`configure` 可覆盖）：基类已接住，缺省用本文件的 `DEFAULT_CONFIG`。 */
  private get rowOptions(): SessionTitleConfig {
    return (this.rowConfig ?? DEFAULT_CONFIG) as SessionTitleConfig;
  }

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, this.rowOptions, {
      sessions: this.sessions,
      sessionProjections: this.sessionProjections,
      agents: this.agents,
    });
  }
}

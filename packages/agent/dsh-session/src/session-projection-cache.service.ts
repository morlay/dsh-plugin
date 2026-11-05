import SessionProjectionCacheService, {
  type Config as SessionProjectionCacheConfig,
} from "@deepseek-ai/dsh-session-projection-cache";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { StorageDomain } from "@morlay/dsh-storage";
import { SessionStore } from "./contract/session.contract.ts";
import { SessionProjectionStore } from "./contract/session-projection-store.contract.ts";
import { SessionProjectionCache } from "./contract/session-projection-cache.contract.ts";

/** 默认配置：每 200 个事件或 5s 写一次（装配面用 `configure` 覆盖）。 */
const DEFAULT_CONFIG: SessionProjectionCacheConfig = {
  writeEveryEvents: 200,
  writeIntervalMs: 5000,
};

// 上游实现（一份 per-record KV + 写穿 checkpoint）。
@Injectable()
export class SessionProjectionCacheDefault extends fromCordis(
  SessionProjectionCache,
  SessionProjectionCacheService,
) {
  storageDomain = inject(StorageDomain);

  sessionProjections = inject(SessionProjectionStore);

  sessions = inject(SessionStore);

  /** 行配置（清单条目的 `config`，`configure` 可覆盖）：基类已接住，缺省用本文件的 `DEFAULT_CONFIG`。 */
  private get rowOptions(): SessionProjectionCacheConfig {
    return (this.rowConfig ?? DEFAULT_CONFIG) as SessionProjectionCacheConfig;
  }

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, this.rowOptions, {
      storageDomain: this.storageDomain,
      sessionProjections: this.sessionProjections,
      sessions: this.sessions,
    });
  }
}

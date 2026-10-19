import SessionProjectionCacheService from "@deepseek-ai/dsh-session-projection-cache";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { StorageDomain } from "@morlay/dsh-storage";
import { SessionStore } from "./contract/session.contract.ts";
import { SessionProjectionStore } from "./contract/session-projection-store.contract.ts";
import { SessionProjectionCache } from "./contract/session-projection-cache.contract.ts";

// 上游实现（一份 per-record KV + 写穿 checkpoint）。
@Injectable()
export class SessionProjectionCacheDefault extends fromCordis(
  SessionProjectionCache,
  SessionProjectionCacheService,
) {
  storageDomain = inject(StorageDomain);

  sessionProjections = inject(SessionProjectionStore);

  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      storageDomain: this.storageDomain,
      sessionProjections: this.sessionProjections,
      sessions: this.sessions,
    });
  }
}

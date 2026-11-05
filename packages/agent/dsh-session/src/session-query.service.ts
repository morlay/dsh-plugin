import SqliteSessionQuerySqliteEngine, { type Config as SqliteQueryConfig } from "@deepseek-ai/dsh-session-query-sqlite";
import { SessionQuery } from "./contract/session-query.contract.ts";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionStore } from "./contract/session.contract.ts";
import { SessionProjectionStore } from "./contract/session-projection-store.contract.ts";

/** 默认配置：内存库、不自动打开（装配面用 `configure` 覆盖）。 */
const DEFAULT_CONFIG: SqliteQueryConfig = { path: ":memory:", openAt: "never" };

@Injectable()
export class SessionQuerySqlite extends fromCordis(SessionQuery, SqliteSessionQuerySqliteEngine) {
  sessions = inject(SessionStore);

  /**
   * 上游引擎在 `observeSession` 里用 `ctx.get('sessionProjections')?.snapshot(session)` 算投影快照——
   * **可选**能力（上游 `inject` 不声明它）。所以这里按 optional 注入、随 mount 交出：装了投影行就给到
   * 它的契约面，没装就与上游同语义地缺省（症状对照：看不到它时 `requires a projected Session observation`）。
   */
  sessionProjections = inject.optional(SessionProjectionStore);

  /** 行配置（清单条目的 `config`，`configure` 可覆盖）：基类已接住，缺省用本文件的 `DEFAULT_CONFIG`。 */
  private get rowOptions(): SqliteQueryConfig {
    return (this.rowConfig ?? DEFAULT_CONFIG) as SqliteQueryConfig;
  }

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, this.rowOptions, {
      sessions: this.sessions,
      ...(this.sessionProjections === undefined ? {} : { sessionProjections: this.sessionProjections }),
    });
  }
}

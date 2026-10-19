import SqliteSessionQuerySqliteEngine from "@deepseek-ai/dsh-session-query-sqlite";
import { SessionQuery } from "./contract/session-query.contract.ts";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionStore } from "./contract/session.contract.ts";
import { SessionProjectionStore } from "./contract/session-projection-store.contract.ts";

@Injectable()
export class SessionQuerySqlite extends fromCordis(SessionQuery, SqliteSessionQuerySqliteEngine) {
  sessions = inject(SessionStore);

  /**
   * 上游引擎在 `observeSession` 里用 `ctx.get('sessionProjections')?.snapshot(session)` 算投影快照——
   * **可选**能力（`static inject` 不声明它）。行作用域的 `get` 只认本行 deps 与根名字视图，
   * 所以这里按 optional 注入、随 mount 交出：装了投影行就给到它的契约面，没装就与上游同语义地缺省
   * （症状对照：看不到它时 `requires a projected Session observation`）。
   */
  sessionProjections = inject.optional(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      ...(this.sessionProjections === undefined ? {} : { sessionProjections: this.sessionProjections }),
    });
  }
}

import SqliteSessionQuerySqliteEngine from "@deepseek-ai/dsh-session-query-sqlite";
import { SessionQuery } from "./session-query.contract.ts";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionStore } from "./session.contract.ts";

@Injectable()
export class SessionQuerySqlite extends fromCordis(SessionQuery, SqliteSessionQuerySqliteEngine) {
  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessions: this.sessions });
  }
}

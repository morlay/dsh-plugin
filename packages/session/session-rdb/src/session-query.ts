import type { Context } from "@deepseek-ai/cordis";
import {
  SessionQueryEngine,
  SessionQueryError,
  type Config,
  type SessionRecord,
} from "@deepseek-ai/dsh-session-query";

export class SessionQueryRdb extends SessionQueryEngine {
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, config);
  }

  // 官方列表（`session/list`）**默认不含已归档**：归档是「收起来」的会话，上游 client 用 workspace registry
  // 的归档集做「只看归档」的派生；完整语料走管理面路由 `SESSION_ROWS_PATH`。
  override async listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    const records = await super.listSessions(signal);
    const archived = this.archivedSessionIds();
    if (archived.size === 0) return records;
    return records.filter((record) => !archived.has(String(record.header.id)));
  }

  // 归档集合来自 workspace registry；服务未就绪时保守返回空集（宁可多给，不可漏掉可见会话）。
  private archivedSessionIds(): ReadonlySet<string> {
    const registry = this.ctx.get("workspaceRegistry" as never) as unknown as
      | { archivedSessionIds?: readonly string[] }
      | undefined;
    return new Set<string>(registry?.archivedSessionIds ?? []);
  }

  override async searchSessions(): Promise<never> {
    throw searchDisabled();
  }

  override async searchEvents(): Promise<never> {
    throw searchDisabled();
  }
}

function searchDisabled(): SessionQueryError {
  return new SessionQueryError(
    "session search is disabled: this deployment serves session queries from the rdb backend without a full-text index",
    "SESSION_QUERY_SEARCH_DISABLED",
  );
}

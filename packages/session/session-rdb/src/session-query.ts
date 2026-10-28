import type { Context } from "@deepseek-ai/cordis";
import {
  SessionQueryEngine,
  SessionQueryError,
  type Config,
  type SessionRecord,
} from "@deepseek-ai/dsh-session-query";

export class SessionQueryRdb extends SessionQueryEngine {
  /**
   * 本次装配用的冷会话观察缓存容量（由 `session-rdb` 行的 `preparedSessionCacheSize` 透传；undefined 表示沿用
   * 上游默认）。它是**按条目数**持有完整 Session 的缓存：条目多一条就多一份完整 append-only log 驻留。
   */
  readonly preparedSessionCacheSize: number | undefined;

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, config);
    this.preparedSessionCacheSize = config.preparedSessionCacheSize;
  }

  // 官方列表（`session/list`）**默认不含已归档**：归档是「收起来」的会话，上游 client 用 workspace registry
  // 的归档集做「只看归档」的派生；完整语料走管理面路由 `SESSION_ROWS_PATH`。
  override async listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    const records = await super.listSessions(signal);
    const archived = await this.archivedSessionIds();
    if (archived.size === 0) return records;
    return records.filter((record) => !archived.has(String(record.header.id)));
  }

  // 归档集合：优先读 workspace registry（它和页面上的归档动作同源）；registry 不在（headless / 启动早期 /
  // 测试装配）就退回持久化里的 `f_archived_at`——`session/list` 默认**不含**已归档是这一层的语义，不能因为
  // 一个可选服务没到就把归档会话又列出来。
  private async archivedSessionIds(): Promise<ReadonlySet<string>> {
    const registry = this.ctx.get("workspaceRegistry" as never) as unknown as
      | { archivedSessionIds?: readonly string[] }
      | undefined;
    if (registry !== undefined) return new Set<string>(registry.archivedSessionIds ?? []);
    const persistence = this.ctx.get("sessionPersistence") as unknown as
      | { archivedSessionIds?: () => Promise<ReadonlySet<string>> }
      | undefined;
    return (await persistence?.archivedSessionIds?.()) ?? new Set<string>();
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

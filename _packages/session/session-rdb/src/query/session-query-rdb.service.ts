// 官方会话查询服务（`ctx.sessionQuery`）的 rdb 实现：查询走上游引擎，行列表走管理面端点。
// 这是上游引擎的薄壳（与 `session-query-sqlite` 同形）：依赖由 cordis 的 `static inject` 提供。
import { SessionAdmin } from "../admin/session-admin.service.ts";
import { inject, Injectable } from "@morlay/zephyr";
import { SessionQuery } from "@morlay/dsh-base/session-query";
import {
  SessionQueryEngine,
  SessionQueryError,
  type Config,
  type SessionRecord,
} from "@deepseek-ai/dsh-session-query";

interface WorkspaceRegistryLike {
  archivedSessionIds?: readonly string[];
}

@Injectable()
export class SessionQueryRdb extends SessionQueryEngine {
  // 令牌就是我们的契约：消费方 `inject(SessionQuery)` 与上游 `ctx.sessionQuery` 落到同一实例。
  static readonly token = SessionQuery;

  // 行列表（含 `f_title`）走管理面的后端查询：rdb 的会话标题不在持久化后端的 header 里。
  admin = inject(SessionAdmin);
  private workspaceRegistry: WorkspaceRegistryLike | undefined;

  constructor(ctx: ConstructorParameters<typeof SessionQueryEngine>[0], config: Config = {}) {
    super(ctx, config);
    // 归档集合来自 workspace registry；它可能比查询服务晚就位，出现时绑定、卸载时解绑。
    ctx.inject(["workspaceRegistry"], (childCtx: ConstructorParameters<typeof SessionQueryEngine>[0]) => {
      const registry = (childCtx as unknown as { workspaceRegistry?: WorkspaceRegistryLike })
        .workspaceRegistry;
      this.workspaceRegistry = registry;
      return () => {
        if (this.workspaceRegistry === registry) this.workspaceRegistry = undefined;
      };
    });
  }

  // 官方列表（`session/list`）**默认不含已归档**：归档是「收起来」的会话，上游 client 用 workspace registry
  // 的归档集做「只看归档」的派生；完整语料走管理面路由 `SESSION_ROWS_PATH`。
  override async listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    const records = await super.listSessions(signal);
    const archived = this.archivedSessionIds();
    // 归档过滤后，用 rdb 的行把标题补上（live-preferred 的 header 没有标题）。
    const { items } = await this.admin.listRows({ pageSize: 1000 });
    const titles = new Map(items.map((row) => [row.sessionId, row.title]));
    return records
      .filter((record) => !archived.has(String(record.header.id)))
      .map((record) => {
        const title = titles.get(String(record.header.id));
        return title === null || title === undefined
          ? record
          : { ...record, header: { ...record.header, title } as SessionRecord["header"] };
      });
  }

  override async searchSessions(): Promise<never> {
    throw searchDisabled();
  }

  override async searchEvents(): Promise<never> {
    throw searchDisabled();
  }

  // 归档集合缺席时保守返回空集（宁可多给，不可漏掉可见会话）。
  private archivedSessionIds(): ReadonlySet<string> {
    return new Set<string>(this.workspaceRegistry?.archivedSessionIds ?? []);
  }
}

function searchDisabled(): SessionQueryError {
  return new SessionQueryError(
    "session search is disabled: this deployment serves session queries from the rdb backend without a full-text index",
    "SESSION_QUERY_SEARCH_DISABLED",
  );
}

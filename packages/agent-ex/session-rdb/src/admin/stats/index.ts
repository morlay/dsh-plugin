// 用量统计的读口径：会话行列表（含 workspace 标题与两段式搜索）。
//
// 总览那一段（`usageReport`）不碰 storage 域，家在数据面 `data/store/stats-report.ts`，这里只转出——
// 管理面与后端用的是同一份口径。派生表可销毁重建；这里只读，不写。
import type { Database } from "@morlay/zephyr-rdb";
import type { SessionListRowsPage } from "../../data/backend.ts";
import type { SessionRowsFilterArgs, SessionRowsSearchStage } from "../../data/store/rows-query.ts";
import type { StorageRepository } from "../../contract/storage-repository.contract.ts";
import { listSessionRows as listSessionRowsQuery } from "../../data/store/session-ops.ts";

export { usageReport } from "../../data/store/stats-report.ts";
export * from "../../data/store/stats-rebuild.ts";

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** 管理面会话行列表的查询条件（结构化过滤与分页都在宿主侧夹住）。 */
export interface SessionRowsListQuery extends SessionRowsFilterArgs {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export async function listSessionRows(
  database: Database,
  storage: StorageRepository,
  query: SessionRowsListQuery = {},
): Promise<SessionListRowsPage & { searchStage: SessionRowsSearchStage }> {
  const needle = query.query?.trim().toLowerCase() ?? "";
  const index = await storage.listWorkspaceIndex();
  const titleMatches =
    needle === ""
      ? []
      : [
          ...new Set(
            index
              .filter((entry) => entry.title.toLowerCase().includes(needle))
              .flatMap((entry) => entry.sessionIds),
          ),
        ];
  const { items, total, searchStage } = await listSessionRowsQuery(database, {
    needle,
    titleMatches,
    includeSubagents: query.includeSubagents === true,
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
    origin: query.origin,
    archived: query.archived,
    updatedAfter: query.updatedAfter,
    updatedBefore: query.updatedBefore,
  });
  const workspaceOf = new Map<string, string>();
  for (const entry of index) {
    for (const sessionId of entry.sessionIds) {
      if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, entry.title);
    }
  }
  return {
    items: items.map((row) => ({
      sessionId: String(row["session_id"]),
      title: asText(row["title"]),
      origin: asText(row["origin"]),
      cwd: asText(row["cwd"]),
      createdAt: Number(row["created_at"]),
      updatedAt: Number(row["updated_at"]),
      archived: Number(row["archived"]) === 1 || row["archived"] === true,
      subagent: row["origin"] === "subagent",
      workspace: workspaceOf.get(String(row["session_id"])) ?? null,
    })),
    total,
    searchStage,
  };
}

export * from "../../data/store/stats-backfill.ts";

export * from "../../data/store/log/usage-fold.ts";

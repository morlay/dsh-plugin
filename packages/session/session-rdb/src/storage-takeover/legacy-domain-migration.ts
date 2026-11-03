// 一次性搬运：旧版把 workspace / schedule / cua 授权域拆成各自的语义表，现在所有域只落
// `t_storage_records`。旧表保留不删（可回退），这里把数据读成上游的文档形状写进新表。
//
// 幂等由调用方用 `t_schema_meta` 的标记控制：搬过一次就不再搬，否则用户清空工作区后重启会把旧数据搬回来。
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import type { StorageRepository } from "./types.ts";

export interface LegacyWorkspaceRow {
  id: string;
  path: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  position: number;
}

export interface LegacyLinkRow {
  workspaceId: string;
  sessionId: string;
  position: number;
}

export interface LegacyWorkspaceStateRow {
  initialized: number | boolean;
  pendingOperation: string | null;
  pendingWorkspaceId: string | null;
}

export interface LegacyScheduleRow {
  id: string;
  sessionId: string;
  status: string;
  record: string;
  lastDelivery: string | null;
  deliveryHistory: string | null;
}

export interface LegacyGlobalRow {
  domain: string;
  value: unknown;
}

export interface LegacyStorageRows {
  workspaces: LegacyWorkspaceRow[];
  links: LegacyLinkRow[];
  state: LegacyWorkspaceStateRow | undefined;
  archived: string[];
  pinned: Array<{ id: string; seq: number }>;
  tasks: LegacyScheduleRow[];
  globals: LegacyGlobalRow[];
}

export const LEGACY_STORAGE_MIGRATION_KEY = "legacy_domain_storage_migrated";

/**
 * 把旧语义表的内容写进通用域存储（`workspace` / `schedule` / 上一版 `t_storage_globals` 的域）。
 * @param rows - 旧表读出来的行。
 * @param repository - 通用域存储。
 */
export async function migrateLegacyDomainStorage(
  rows: LegacyStorageRows,
  repository: StorageRepository,
): Promise<void> {
  if (rows.workspaces.length > 0 || rows.state !== undefined) {
    for (const row of rows.workspaces) {
      const sessionIds = rows.links
        .filter((link) => link.workspaceId === row.id)
        .sort((left, right) => left.position - right.position)
        .map((link) => link.sessionId as SessionId);
      await repository.putDomainRecord("workspace", "workspaces", row.id, {
        path: row.path,
        title: row.title,
        sessionIds,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    const pending = rows.state?.pendingOperation;
    const pendingMutation =
      pending === "create" || pending === "delete"
        ? {
            operation: pending,
            workspaceId: (rows.state?.pendingWorkspaceId ?? "") as WorkspaceId,
          }
        : undefined;
    await repository.writeDomainGlobal("workspace", {
      initialized: rows.state === undefined ? true : Boolean(rows.state.initialized),
      workspaceIds: rows.workspaces
        .filter((row) => row.position >= 0)
        .sort((left, right) => left.position - right.position)
        .map((row) => row.id as WorkspaceId),
      archivedSessionIds: rows.archived.map((id) => id as SessionId),
      pinnedSessionIds: rows.pinned
        .sort((left, right) => left.seq - right.seq)
        .map((row) => row.id as SessionId),
      ...(pendingMutation === undefined ? {} : { pendingMutation }),
    });
    await repository.insertUnitVersion("workspace", 2);
  }

  for (const row of rows.tasks) {
    await repository.putDomainRecord("schedule", "tasks", row.id, {
      sessionId: row.sessionId as SessionId,
      record: JSON.parse(row.record),
      status: row.status === "inactive" ? "inactive" : "active",
      ...(row.lastDelivery === null ? {} : { lastDelivery: JSON.parse(row.lastDelivery) }),
      ...(row.deliveryHistory === null ? {} : { deliveryHistory: JSON.parse(row.deliveryHistory) }),
    });
  }
  if (rows.tasks.length > 0) await repository.insertUnitVersion("schedule", 1);

  // 上一版只有一个域一张的 `t_storage_globals`（cua 授权域），搬进同一张通用表。
  for (const row of rows.globals) {
    await repository.writeDomainGlobal(row.domain, row.value);
    await repository.insertUnitVersion(row.domain, 1);
  }
}

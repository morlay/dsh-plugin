import { E, type Database } from "@morlay/zephyr-rdb";
import { storageRecords } from "../entities/index.ts";
import type { WorkspaceDomainState, WorkspaceRecord } from "./types.ts";

const WORKSPACE_DOMAIN = "workspace";
const WORKSPACE_TABLE = "workspaces";
const GLOBAL_TABLE = "";

/**
 * 删除会话后清掉 workspace 文档里的归属与归档 / 钉住集合。
 *
 * 域存储只有 `t_storage_records` 一份，没有再 join 的归属表，所以删除路径得读改文档。调用方保证在
 * 写事务内：SQLite 用同一连接上的 `Database`，PG 用当前事务的 scoped `Database`。
 * @param database - 当前执行面（事务内就是 scoped 实例）。
 * @param ids - 刚删除的会话 id。
 */
export async function pruneWorkspaceDocuments(
  database: Database,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const records = database.table(storageRecords);
  const scope = E.and(
    E.eq(records.f_domain, WORKSPACE_DOMAIN),
    E.eq(records.f_table, WORKSPACE_TABLE),
  );
  const drop = new Set<string>(ids);

  for await (const row of records
    .select({ key: records.f_key, value: records.f_value })
    .where(scope)) {
    const record = JSON.parse(row.value) as WorkspaceRecord;
    const kept = record.sessionIds.filter((sessionId) => !drop.has(sessionId));
    if (kept.length === record.sessionIds.length) continue;
    await records.update(
      { f_value: JSON.stringify({ ...record, sessionIds: kept }) },
      E.and(
        E.eq(records.f_domain, WORKSPACE_DOMAIN),
        E.eq(records.f_table, WORKSPACE_TABLE),
        E.eq(records.f_key, row.key),
      ),
    );
  }

  let globalValue: string | undefined;
  for await (const row of records
    .select({ value: records.f_value })
    .where(E.and(E.eq(records.f_domain, WORKSPACE_DOMAIN), E.eq(records.f_table, GLOBAL_TABLE)))) {
    globalValue = row.value;
  }
  if (globalValue === undefined) return;
  const state = JSON.parse(globalValue) as WorkspaceDomainState;
  const archivedSessionIds = state.archivedSessionIds.filter((sessionId) => !drop.has(sessionId));
  const pinnedSessionIds = (state.pinnedSessionIds ?? []).filter(
    (sessionId) => !drop.has(sessionId),
  );
  if (
    archivedSessionIds.length === state.archivedSessionIds.length &&
    pinnedSessionIds.length === (state.pinnedSessionIds ?? []).length
  ) {
    return;
  }
  const next: WorkspaceDomainState = { ...state, archivedSessionIds, pinnedSessionIds };
  await records.update(
    { f_value: JSON.stringify(next) },
    E.and(E.eq(records.f_domain, WORKSPACE_DOMAIN), E.eq(records.f_table, GLOBAL_TABLE)),
  );
}

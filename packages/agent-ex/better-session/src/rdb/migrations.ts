import { E, defineTable, type Migration } from "@morlay/zephyr-rdb";
import { sessions } from "./entities/index.ts";
import {
  migrateLegacyDomainStorage,
  type LegacyLinkRow,
  type LegacyScheduleRow,
  type LegacyWorkspaceRow,
  type LegacyWorkspaceStateRow,
} from "./storage-takeover/legacy-domain-migration.ts";
import { createStorageRepository } from "./storage-takeover/repository.ts";

// 旧语义表的定义：只用于读（旧表保留可回退，这里不改它们）。列名与当年的 DDL 一致。
const legacyWorkspaces = defineTable({
  name: "t_workspaces",
  columns: {
    f_workspace_id: { type: "text", primaryKey: true },
    f_path: { type: "text" },
    f_title: { type: "text" },
    f_created_at: { type: "text" },
    f_updated_at: { type: "text" },
    f_position: { type: "integer" },
  },
});

const legacyLinks = defineTable({
  name: "t_workspace_sessions",
  columns: {
    f_workspace_id: { type: "text" },
    f_session_id: { type: "text" },
    f_position: { type: "integer" },
  },
});

const legacyWorkspaceState = defineTable({
  name: "t_workspace_state",
  columns: {
    f_singleton: { type: "integer", primaryKey: true },
    f_initialized: { type: "integer" },
    f_pending_operation: { type: "text" },
    f_pending_workspace_id: { type: "text" },
  },
});

const legacyScheduleTasks = defineTable({
  name: "t_schedule_tasks",
  columns: {
    f_id: { type: "text", primaryKey: true },
    f_session_id: { type: "text" },
    f_status: { type: "text" },
    f_record: { type: "text" },
    f_last_delivery: { type: "text" },
    f_delivery_history: { type: "text" },
  },
});

const legacyGlobals = defineTable({
  name: "t_storage_globals",
  columns: {
    f_domain: { type: "text", primaryKey: true },
    f_value: { type: "text" },
  },
});

/**
 * 旧语义表（workspace / schedule / cua 授权域）→ 通用域存储的一次性搬运。
 *
 * 旧表保留可回退；是否搬过由 `t_schema_migrations` 账本决定（只跑一次），不再需要 `t_schema_meta` 标记。
 */
export function sessionMigrations(): readonly Migration[] {
  return [
    {
      id: "20261028-legacy-domain-storage",
      up: async (tx) => {
        // 旧表不存在（新库 / 还没升到这一版）：这次不搬、也不记账，以后真出现旧表还会再试。
        const objects = new Set(await tx.objectNames());
        if (!objects.has(legacyWorkspaces.name)) return false;

        const workspaces: LegacyWorkspaceRow[] = [];
        if (objects.has(legacyWorkspaces.name)) {
          const table = tx.table(legacyWorkspaces);
          for await (const row of table.select({
            id: table.f_workspace_id,
            path: table.f_path,
            title: table.f_title,
            createdAt: table.f_created_at,
            updatedAt: table.f_updated_at,
            position: table.f_position,
          })) {
            workspaces.push({
              id: String(row.id),
              path: String(row.path ?? ""),
              title: String(row.title ?? ""),
              createdAt: String(row.createdAt ?? ""),
              updatedAt: String(row.updatedAt ?? ""),
              position: Number(row.position ?? 0),
            });
          }
        }

        const links: LegacyLinkRow[] = [];
        if (objects.has(legacyLinks.name)) {
          const table = tx.table(legacyLinks);
          for await (const row of table.select({
            workspaceId: table.f_workspace_id,
            sessionId: table.f_session_id,
            position: table.f_position,
          })) {
            links.push({
              workspaceId: String(row.workspaceId),
              sessionId: String(row.sessionId),
              position: Number(row.position ?? 0),
            });
          }
        }

        let state: LegacyWorkspaceStateRow | undefined;
        if (objects.has(legacyWorkspaceState.name)) {
          const table = tx.table(legacyWorkspaceState);
          for await (const row of table
            .select({
              initialized: table.f_initialized,
              pendingOperation: table.f_pending_operation,
              pendingWorkspaceId: table.f_pending_workspace_id,
            })
            .where(E.eq(table.f_singleton, 1))
            .limit(1)) {
            state = {
              initialized: Number(row.initialized ?? 0),
              pendingOperation: row.pendingOperation,
              pendingWorkspaceId: row.pendingWorkspaceId,
            };
          }
        }

        const tasks: LegacyScheduleRow[] = [];
        if (objects.has(legacyScheduleTasks.name)) {
          const table = tx.table(legacyScheduleTasks);
          for await (const row of table.select({
            id: table.f_id,
            sessionId: table.f_session_id,
            status: table.f_status,
            record: table.f_record,
            lastDelivery: table.f_last_delivery,
            deliveryHistory: table.f_delivery_history,
          })) {
            tasks.push({
              id: String(row.id),
              sessionId: String(row.sessionId ?? ""),
              status: String(row.status ?? ""),
              record: String(row.record ?? ""),
              lastDelivery: row.lastDelivery,
              deliveryHistory: row.deliveryHistory,
            });
          }
        }

        const globals: Array<{ domain: string; value: unknown }> = [];
        if (objects.has(legacyGlobals.name)) {
          const table = tx.table(legacyGlobals);
          for await (const row of table.select({
            domain: table.f_domain,
            value: table.f_value,
          })) {
            globals.push({ domain: String(row.domain), value: JSON.parse(String(row.value)) });
          }
        }

        const sessionRows = sessions.table(tx);
        const archived: string[] = [];
        for await (const row of sessionRows
          .select({ id: sessionRows.f_session_id })
          .where(E.isNotNull(sessionRows.f_archived_at))
          .orderBy(sessionRows.f_archived_at)) {
          archived.push(String(row.id));
        }
        const pinned: Array<{ id: string; seq: number }> = [];
        for await (const row of sessionRows
          .select({ id: sessionRows.f_session_id, seq: sessionRows.f_pinned_seq })
          .where(E.isNotNull(sessionRows.f_pinned_seq))
          .orderBy(sessionRows.f_pinned_seq)) {
          pinned.push({ id: String(row.id), seq: Number(row.seq) });
        }

        // 迁移已经在一个事务里：仓储的写用直通（不再 BEGIN），否则会变成嵌套事务。
        const storage = createStorageRepository({
          database: tx,
          writeAtomically: async (fn) => await fn(tx),
        });
        await migrateLegacyDomainStorage(
          { workspaces, links, state, archived, pinned, tasks, globals },
          storage,
        );
      },
    },
  ];
}

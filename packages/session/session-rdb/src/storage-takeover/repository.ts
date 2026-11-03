import { randomUUID } from "node:crypto";
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionLogOffset,
  SessionSeq,
} from "@deepseek-ai/dsh-session";
import type { SessionSeqCursor } from "@deepseek-ai/dsh-session";
import type {
  CheckpointIdentity,
  DomainRecord,
  ProjectionCheckpoint,
  ProjectionCheckpointRow,
  StorageRepository,
  StorageRepositoryHost,
  StoredProjcacheEntry,
  WorkspaceDomainState,
  WorkspaceIndexEntry,
  WorkspaceRecord,
} from "./types.ts";
import { E, type Database } from "@morlay/rdbkit";
import { sessionProjcacheRows, sessions, storageRecords, storageUnits } from "../entities/index.ts";

function identityOfSession(row: {
  fVersion: number;
  fCreatedAt: number;
  fCwd: string | null;
  fSeedLength: number | null;
}): CheckpointIdentity {
  return {
    formatVersion: row.fVersion,
    createdAt: row.fCreatedAt,
    ...(row.fCwd === null ? {} : { cwd: row.fCwd }),
    isSeeded: row.fSeedLength !== null,
    ...(row.fSeedLength === null ? {} : { inheritedEventCount: SessionLogOffset(row.fSeedLength) }),
  };
}

function seqCursor(seq: number): SessionSeqCursor {
  return seq === -1 ? -1 : SessionSeq(seq);
}

export function createStorageRepository(host: StorageRepositoryHost): StorageRepository {
  const records = storageRecords.table(host.database);
  const projcache = sessionProjcacheRows.table(host.database);
  const sessionRows = sessions.table(host.database);
  const units = storageUnits.table(host.database);

  /** 读一个域的 global（空表名那一行）；没有就返回 `null`（域层据此用 initial）。 */
  async function readGlobal(domain: string): Promise<unknown> {
    for await (const row of records
      .select({ value: records.column("f_value") })
      .where(E.and(E.eq(records.f_domain, domain), E.eq(records.f_table, GLOBAL_TABLE)))) {
      return JSON.parse(row.value);
    }
    return null;
  }

  const GLOBAL_TABLE = "";
  const WORKSPACE_DOMAIN = "workspace";
  const WORKSPACE_TABLE = "workspaces";

  // workspace 的 global 里那两个集合仍是会话行上的标记：列表的 archived 与钉住顺序按会话查；
  // 文档是唯一的域存储，这里只写穿（找不到会话行的 id 跳过，与既有语义一致）。
  async function syncSessionFlags(database: Database, state: WorkspaceDomainState): Promise<void> {
    const table = sessions.table(database);
    const pinned = state.pinnedSessionIds ?? [];
    // 钉住：先把不在集合里的置空，再按位置写（找不到会话行就跳过，与既有语义一致）。
    await table.update({ f_pinned_seq: null }, E.isNotNull(table.f_pinned_seq));
    for (const [position, sessionId] of pinned.entries()) {
      await table.update({ f_pinned_seq: position }, E.eq(table.f_session_id, sessionId));
    }

    const archived = state.archivedSessionIds;
    await table.update({ f_archived_at: null }, E.isNotNull(table.f_archived_at));
    const stamp = Date.now();
    for (const sessionId of archived) {
      // 旧库的归档集合里可能有还没落会话行的 id：先补一行再打标记。
      await table.insertIgnore(
        {
          f_session_id: sessionId,
          f_head_event_id: "",
          f_head_sequence: -1,
          f_version: SESSION_FORMAT_VERSION,
          f_created_at: stamp,
          f_cwd: null,
          f_parent_session: null,
          f_seed_length: null,
          f_origin: null,
          f_delegation_depth: null,
          f_incarnation: randomUUID(),
          f_revision: 0,
          f_archived_at: stamp,
        },
        ["f_session_id"],
      );
      await table.update({ f_archived_at: stamp }, E.eq(table.f_session_id, sessionId));
    }
  }

  return {
    async readUnitVersion(name: string): Promise<number | undefined> {
      for await (const row of units
        .select({ version: units.column("f_version") })
        .where(E.eq(units.f_name, name))) {
        return row.version;
      }
      return undefined;
    },

    async insertUnitVersion(name: string, version: number): Promise<void> {
      await host.writeAtomically(async () => {
        await units.insertIgnore({ f_name: name, f_version: version }, ["f_name"]);
      });
    },

    async listDomainRecords(domain: string): Promise<DomainRecord[]> {
      const result: DomainRecord[] = [];
      for await (const row of records
        .select({
          table: records.column("f_table"),
          key: records.column("f_key"),
          value: records.column("f_value"),
        })
        .where(E.eq(records.f_domain, domain))) {
        if (row.table === "") continue;
        result.push({ table: row.table, key: row.key, value: JSON.parse(row.value) });
      }
      return result;
    },

    async readDomainGlobal(domain: string): Promise<unknown> {
      return await readGlobal(domain);
    },

    async putDomainRecord(
      domain: string,
      table: string,
      key: string,
      value: unknown,
    ): Promise<void> {
      await host.writeAtomically(async () => {
        await records.upsert(
          { f_domain: domain, f_table: table, f_key: key, f_value: JSON.stringify(value) },
          ["f_domain", "f_table", "f_key"],
          ["f_value"],
        );
      });
    },

    async deleteDomainRecord(domain: string, table: string, key: string): Promise<void> {
      await host.writeAtomically(async () => {
        await records.delete(
          E.and(E.eq(records.f_domain, domain), E.eq(records.f_table, table), E.eq(records.f_key, key)),
        );
      });
    },

    async deleteDomainRecords(
      domain: string,
      table: string,
      keys: readonly string[],
    ): Promise<void> {
      if (keys.length === 0) return;
      await host.writeAtomically(async () => {
        await records.delete(
          E.and(
            E.eq(records.f_domain, domain),
            E.eq(records.f_table, table),
            E.inList(records.f_key, [...new Set(keys)]),
          ),
        );
      });
    },

    async writeDomainGlobal(domain: string, value: unknown): Promise<void> {
      await host.writeAtomically(async () => {
        await records.upsert(
          { f_domain: domain, f_table: "", f_key: "", f_value: JSON.stringify(value) },
          ["f_domain", "f_table", "f_key"],
          ["f_value"],
        );
        // workspace 的归档 / 钉住仍是会话行上的标记（列表与删除都按会话查），由这里写穿。
        if (domain === WORKSPACE_DOMAIN) {
          await syncSessionFlags(host.database, value as WorkspaceDomainState);
        }
      });
    },

    async listWorkspaceIndex(): Promise<WorkspaceIndexEntry[]> {
      const rows: Array<{ id: string; record: WorkspaceRecord }> = [];
      for await (const row of records
        .select({ key: records.column("f_key"), value: records.column("f_value") })
        .where(
          E.and(E.eq(records.f_domain, WORKSPACE_DOMAIN), E.eq(records.f_table, WORKSPACE_TABLE)),
        )) {
        rows.push({ id: row.key, record: JSON.parse(row.value) as WorkspaceRecord });
      }
      const state = (await readGlobal(WORKSPACE_DOMAIN)) as WorkspaceDomainState | null;
      const order = new Map<string, number>(
        (state?.workspaceIds ?? []).map((id, position) => [String(id), position]),
      );
      return rows
        .sort(
          (left, right) =>
            (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        )
        .map(({ id, record }) => ({ id, title: record.title, sessionIds: [...record.sessionIds] }));
    },

    async loadProjcache(): Promise<StoredProjcacheEntry[]> {
      const entries = new Map<string, StoredProjcacheEntry>();
      for await (const row of sessionRows.select({
        sessionId: sessionRows.f_session_id,
        version: sessionRows.f_version,
        createdAt: sessionRows.f_created_at,
        cwd: sessionRows.f_cwd,
        seedLength: sessionRows.f_seed_length,
        title: sessionRows.f_title,
        titleSeq: sessionRows.f_title_seq,
      })) {
        entries.set(row.sessionId, {
          sessionId: SessionId(row.sessionId),
          identity: identityOfSession({
            fVersion: row.version,
            // `f_created_at` 是 bigint（读回 BigInt）：投影身份的 createdAt 用 number。
            fCreatedAt: Number(row.createdAt),
            fCwd: row.cwd,
            fSeedLength: row.seedLength,
          }),
          rows: {},
          ...(typeof row.title === "string" && typeof row.titleSeq === "number"
            ? { title: { title: row.title, seq: row.titleSeq } }
            : {}),
        });
      }
      if (entries.size === 0) return [];
      for await (const row of projcache.select({
        sessionId: projcache.f_session_id,
        key: projcache.f_key,
        ver: projcache.f_ver,
        seq: projcache.f_seq,
        val: projcache.f_val,
      })) {
        const entry = entries.get(row.sessionId);
        if (entry === undefined) continue;
        entry.rows[row.key] = {
          ver: row.ver,
          seq: seqCursor(row.seq),
          val: JSON.parse(row.val),
        } satisfies ProjectionCheckpointRow;
      }
      return [...entries.values()].filter((entry) => Object.keys(entry.rows).length > 0);
    },

    async readSessionTitle(sessionId: string): Promise<{ title: string; seq: number } | undefined> {
      const table = sessions.table(host.database);
      for await (const row of table
        .select({ title: table.f_title, seq: table.f_title_seq })
        .where(E.eq(table.f_session_id, sessionId))) {
        return row.title === null || row.seq === null
          ? undefined
          : { title: row.title, seq: row.seq };
      }
      return undefined;
    },

    async putProjcache(sessionId: string, rows: ProjectionCheckpoint): Promise<void> {
      const values = Object.entries(rows).map(([key, row]) => ({
        f_session_id: sessionId,
        f_key: key,
        f_ver: row.ver,
        f_seq: row.seq,
        f_val: JSON.stringify(row.val),
      }));
      await host.writeAtomically(async () => {
        await projcache.delete(E.eq(projcache.f_session_id, sessionId));
        if (values.length > 0) await projcache.insertMany(values);
      });
    },

    async patchProjcache(
      sessionId: string,
      changed: ProjectionCheckpoint,
      removedKeys: readonly string[],
    ): Promise<void> {
      const values = Object.entries(changed).map(([key, row]) => ({
        f_session_id: sessionId,
        f_key: key,
        f_ver: row.ver,
        f_seq: row.seq,
        f_val: JSON.stringify(row.val),
      }));
      const touched = [...Object.keys(changed), ...removedKeys];
      if (touched.length === 0) return;
      await host.writeAtomically(async () => {
        // 只碰这些 key 的行：先删（同时承担 removedKeys 的删除），再插入变化行。
        await projcache.delete(
          E.and(E.eq(projcache.f_session_id, sessionId), E.inList(projcache.f_key, touched)),
        );
        if (values.length > 0) await projcache.insertMany(values);
      });
    },

    async pruneStaleProjcache(): Promise<number> {
      const stale: string[] = [];
      for await (const row of projcache
        .select({ sessionId: projcache.f_session_id })
        .where(
          E.and(
            E.lt(projcache.f_seq, 0),
            E.inSubquery(
              projcache.f_session_id,
              sessionRows
                .select({ id: sessionRows.f_session_id })
                .where(E.gte(sessionRows.f_head_sequence, 0))
                .toFragment(),
            ),
          ),
        )) {
        stale.push(row.sessionId);
      }
      if (stale.length === 0) return 0;
      await host.writeAtomically(async () => {
        await projcache.delete(E.inList(projcache.f_session_id, stale));
      });
      return stale.length;
    }

  };
}

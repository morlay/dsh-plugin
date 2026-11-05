import type { SessionId } from "@morlay/dsh-session/contract";
import type { CheckpointIdentity } from "@morlay/dsh-session/contract";
import type { ProjectionCheckpoint, ProjectionCheckpointRow } from "@morlay/dsh-session/contract";
import type { WorkspaceDomainState, WorkspaceRecord } from "@morlay/dsh-workspace/contract";
import type { Database } from "@morlay/zephyr-rdb";

export type {
  CheckpointIdentity,
  ProjectionCheckpoint,
  ProjectionCheckpointRow,
  WorkspaceDomainState,
  WorkspaceRecord,
};

export interface DomainRecord {
  table: string;
  key: string;
  value: unknown;
}

export interface WorkspaceIndexEntry {
  id: string;
  title: string;
  sessionIds: string[];
}

export interface StorageRepositoryHost {
  /** 统一的查询面（结构、迁移与域读写都走它）。 */
  database: Database;

  /** 把一组写做成一次事务（宿主管连接与隔离级别）。 */
  writeAtomically: <T>(fn: (database: Database) => Promise<T>) => Promise<T>;
}

export interface StoredProjcacheEntry {
  sessionId: SessionId;
  identity: CheckpointIdentity;
  rows: ProjectionCheckpoint;
  /** 会话标题（随快照一起加载 / 写路径刷新；`cachedSnapshot` 缺标题时用它补，不回库直读）。 */
  title?: { title: string; seq: number };
}

export interface StorageRepository {
  readUnitVersion(name: string): Promise<number | undefined>;

  insertUnitVersion(name: string, version: number): Promise<void>;

  // 所有 storage 域共用：`(domain, table, key)` 一行，值是整份记录文档。global 单例用
  // `table = ''`、`key = ''`；读不到返回 `null`（域层据此改用 spec 的 initial，与上游
  // `KvUnit.loadAll` 的哨兵语义一致）。
  listDomainRecords(domain: string): Promise<DomainRecord[]>;

  readDomainGlobal(domain: string): Promise<unknown>;

  putDomainRecord(domain: string, table: string, key: string, value: unknown): Promise<void>;

  deleteDomainRecord(domain: string, table: string, key: string): Promise<void>;

  // 一次批量（上游 `KvUnit.deleteRecords` 的契约：行存储要么一次做完、要么不做）。
  deleteDomainRecords(domain: string, table: string, keys: readonly string[]): Promise<void>;

  writeDomainGlobal(domain: string, value: unknown): Promise<void>;

  // 会话面读 workspace 文档：列表的标题与搜索、删除会话时清理归属。数据只有 `t_storage_records`
  // 一份，所以这两条走文档（workspace 数量级小，整份读没问题）。
  listWorkspaceIndex(): Promise<WorkspaceIndexEntry[]>;

  loadProjcache(): Promise<StoredProjcacheEntry[]>;

  /** 会话标题（投影缓存的镜像刷新与 `cachedSnapshot` 补标题用）。 */
  readSessionTitle(sessionId: string): Promise<{ title: string; seq: number } | undefined>;

  putProjcache(sessionId: string, rows: ProjectionCheckpoint): Promise<void>;

  /** 增量写回：只 upsert `changed` 里的行、删掉 `removedKeys`，其余行原样不动。 */
  patchProjcache(
    sessionId: string,
    changed: ProjectionCheckpoint,
    removedKeys: readonly string[],
  ): Promise<void>;

  pruneStaleProjcache(): Promise<number>;
}

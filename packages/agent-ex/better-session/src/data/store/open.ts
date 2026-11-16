import { randomUUID } from "node:crypto";
import { chmod, mkdir, open as openFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fingerprintHex,
  openDatabase as openRdbkitDatabase,
  runMigrations,
  type Database,
  type LibraryIdentity,
  type SchemaDrift,
} from "@morlay/zephyr-rdb";
import type { Backend } from "../backend.ts";
import { catalog, persistenceState } from "../entities/index.ts";
import { sessionMigrations } from "./migrations.ts";
import { createReadModel } from "./read-model.ts";
import { createStorageRepository } from "./storage-repository.ts";
import {
  DEFAULT_BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
  SESSION_LIBRARY_NAME,
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
  type JournalMode,
} from "../version.ts";
import { backfillUsageTables } from "./stats-backfill.ts";
import { RdbBackend } from "../backend-rdb.ts";
import { SessionStoreError } from "../errors.ts";

export type BackendConfig =
  | { type: "sqlite"; path: string; journalMode?: JournalMode; busyTimeout?: number }
  | { type: "postgres"; connectionString: string; schema?: string };

/** 打开数据库、对齐结构、跑迁移、落 identity（连接、库身份、回填都在这一步）。 */
export async function openRdbBackend(config: BackendConfig): Promise<Backend> {
  const schema = config.type === "postgres" ? (config.schema ?? "public") : "";
  const actualPath =
    config.type === "sqlite" && config.path !== ":memory:" ? resolve(config.path) : undefined;
  if (actualPath !== undefined) {
    // 库文件与目录的权限：目录 0700（不改变已有目录的 mode），文件 0600（WAL / SHM 继承）。
    await mkdir(dirname(actualPath), { recursive: true, mode: 0o700 });
    try {
      // 独占创建：新建的文件固定 0600；已存在的文件保留它自己的 mode。
      const handle = await openFile(actualPath, "wx", 0o600);
      await handle.close();
      await chmod(actualPath, 0o600);
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
  const database = await openRdbkitDatabase(
    config.type === "sqlite"
      ? {
          dialect: "sqlite",
          path: actualPath ?? config.path,
          ...(config.journalMode === undefined ? {} : { journalMode: config.journalMode }),
          // journal_mode 等校验通过后再切（拒绝旧库时不能改动它）。
          applyJournalMode: false,
          busyTimeout: config.busyTimeout ?? DEFAULT_BUSY_TIMEOUT_MS,
          cacheSizeKb: 65536,
          mmapSize: 268435456,
        }
      : {
          dialect: "postgres",
          connectionString: config.connectionString,
          ...(config.schema === undefined ? {} : { schema: config.schema }),
          isolationLevel: "serializable",
        },
  );

  try {
    // 写事务按库身份串行由 rdbkit 承担（同进程同库共用一条队列），这里不再包一层。
    const inWrite = <T>(fn: (scoped: Database) => Promise<T>): Promise<T> =>
      database.transaction(fn);
    if (actualPath !== undefined) {
      // SQLite 自己创建 WAL / SHM / 回滚日志时用默认 mode（受 umask 影响），统一收成 0600。
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        try {
          await chmod(`${actualPath}${suffix}`, 0o600);
        } catch {
          // 文件还没创建（未进入 WAL / 没有回滚日志）就跳过。
        }
      }
    }

    // 打标记、建表、迁移、回填、identity 是**一个事务**：任一步失败都不在库里留痕
    //（旧版本 / 别人的库被拒时，连表与版本戳都不该出现）。
    let storeId: string | undefined;
    await inWrite(async (scoped) => {
      // 库身份是事务的第一步：初始化失败时连身份戳也不留在库里。
      await claimLibrary(scoped, config);
      // 结构对齐由 `runMigrations` 自己做（它还多管迁移账本）：这里只取它交回的漂移。
      const { drift } = await runMigrations(scoped, {
        catalog,
        migrations: sessionMigrations(),
      });
      warnManualDrift(drift);
      await backfillUsageTables(scoped);

      const state = persistenceState.table(scoped);
      await state.insertIgnore({ f_singleton: 1, f_store_id: randomUUID() }, ["f_singleton"]);
      for await (const row of state.select({ storeId: state.f_store_id })) storeId = row.storeId;
    });
    if (storeId === undefined || storeId.length === 0) {
      throw new SessionStoreError(
        "SESSION_STORAGE_INCOMPATIBLE",
        "session database has no valid store identity",
      );
    }
    if (config.type === "sqlite") {
      // 结构对齐成功后才切 journal_mode：被拒的库不能被改动。
      await database.setSqlitePragma("journal_mode", (config.journalMode ?? "wal").toLowerCase());
    }

    const storage = createStorageRepository({
      database,
      writeAtomically: (fn) => inWrite((scoped) => fn(scoped)),
    });
    const storeIdentity =
      config.type === "sqlite"
        ? actualPath === undefined
          ? `memory:store:${storeId}`
          : await fileIdentity(actualPath, storeId)
        : `${config.type}:${config.connectionString}:${schema}:store:${storeId}`;
    return new RdbBackend({
      kind: config.type,
      database,
      storage,
      readModel: createReadModel(database),
      storeIdentity,
    });
  } catch (error) {
    await database.close();
    throw error;
  }
}

// 结构漂移的消费口径：库里有、catalog 没有的表（orphan），以及改列类型 / 可空 / 默认值这类差异，
// **只报告不自动修**——记一条汇总 warn（列出表名 / 列名），不阻塞打开：DDL 的破坏性动作由人决定。
// 可自动修的漂移（索引重建 / 补唯一约束）在 `runMigrations` 里已经修好，不进这条 warn。
function warnManualDrift(drift: readonly SchemaDrift[]): void {
  const manual = drift.filter((entry) => entry.fix === "manual");
  if (manual.length === 0) return;
  console.warn(
    "session-rdb: 库结构与表定义有 " +
      String(manual.length) +
      " 处漂移，只报告不自动修（改列 / 删表由人决定）：" +
      manual.map((entry) => entry.detail).join("; "),
  );
}

/** 库文件身份：`file:dev:ino:birthtimeNs:store:<storeId>`（符号链接指向同一 inode 时身份相同）。 */
async function fileIdentity(path: string, storeId: string): Promise<string> {
  const identity = await stat(path, { bigint: true });
  return `file:${identity.dev}:${identity.ino}:${identity.birthtimeNs}:store:${storeId}`;
}

// 库身份：本构建只认「dsh-session @ SCHEMA_VERSION」。未认领的库只有在**空库**时才被认领，
// 有表却没身份就是旧库或别人的库（拒绝并要求显式迁移，破坏性动作由人决定）。
async function claimLibrary(database: Database, config: BackendConfig): Promise<void> {
  const identity: LibraryIdentity = { name: SESSION_LIBRARY_NAME, version: SCHEMA_VERSION };
  const where = config.type === "sqlite" ? config.path : config.connectionString;
  if (config.type === "sqlite") {
    // 结构版本不是库身份：没写过身份的库也可能带着一个我们不认识的结构版本。
    const onDisk = Number((await database.sqlitePragma("user_version")) ?? 0);
    if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
      throw new SessionStoreError(
        "SESSION_STORAGE_INCOMPATIBLE",
        "session database at " +
          where +
          " has schema version " +
          String(onDisk) +
          ", incompatible with this build (" +
          String(SCHEMA_VERSION) +
          ")",
      );
    }
  }
  const stored = await database.readIdentity();
  if (stored === undefined) {
    const objects = await database.objectNames();
    if (objects.length > 0) {
      throw new SessionStoreError(
        "SESSION_STORAGE_INCOMPATIBLE",
        "session database at " + where + " has an unversioned schema or application identity",
      );
    }
    await database.writeIdentity(identity);
    return;
  }
  if (stored.fingerprint !== fingerprintHex(identity.name) || stored.version !== identity.version) {
    if (config.type === "sqlite") {
      if (stored.version === 0) {
        throw new SessionStoreError(
          "SESSION_STORAGE_INCOMPATIBLE",
          "session database at " + where + " has an unversioned schema or application identity",
        );
      }
      throw new SessionStoreError(
        "SESSION_STORAGE_INCOMPATIBLE",
        "session database at " +
          where +
          " has application id " +
          String(Number.parseInt(stored.fingerprint, 16)) +
          ", expected " +
          String(SESSION_PERSISTENCE_SQLITE_APPLICATION_ID),
      );
    }
    throw new SessionStoreError(
      "SESSION_STORAGE_INCOMPATIBLE",
      "session database at " +
        where +
        " has library identity " +
        stored.fingerprint +
        "@" +
        String(stored.version) +
        ", incompatible with this build (" +
        fingerprintHex(identity.name) +
        "@" +
        String(identity.version) +
        ")",
    );
  }
}

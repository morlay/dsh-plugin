import { randomUUID } from "node:crypto";
import { chmod, mkdir, open as openFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ensureSchema, openDatabase as openRdbkitDatabase, runMigrations, type Database } from "@morlay/rdbkit";
import type { Backend } from "../backend.ts";
import { catalog, persistenceState } from "../entities/index.ts";
import { sessionMigrations } from "../migrations.ts";
import { createReadModel } from "../storage-takeover/read-model.ts";
import { createStorageRepository } from "../storage-takeover/repository.ts";
import {
  DEFAULT_BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
  type JournalMode,
} from "../version.ts";
import { backfillUsageTables } from "./stats.ts";
import { RdbBackend } from "../backend-rdb.ts";

export type BackendConfig =
  | { type: "sqlite"; path: string; journalMode?: JournalMode; busyTimeout?: number }
  | { type: "postgres"; connectionString: string; schema?: string };


/**
 * 写事务按介质串行：SQLite 的 `BEGIN IMMEDIATE` 并发会直接 busy，PG 的 `serializable` 并发会冲突；
 * 同一个库（进程内多个实例）共用一条队列。
 */
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const tail = writeQueues.get(key) ?? Promise.resolve();
  const run = tail.then(fn);
  writeQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

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
    let onDisk = 0;
    if (config.type === "sqlite") {
      onDisk = Number((await database.sqlitePragma("user_version")) ?? 0);
      const applicationId = Number((await database.sqlitePragma("application_id")) ?? 0);
      if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
        throw new Error(
          `session database at "${config.path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
        );
      }
      if (onDisk >= 1 && applicationId !== SESSION_PERSISTENCE_SQLITE_APPLICATION_ID) {
        throw new Error(
          `session database at "${config.path}" has application id ${applicationId}, expected ${SESSION_PERSISTENCE_SQLITE_APPLICATION_ID}`,
        );
      }
      if (onDisk === 0) {
        // 有表但没版本标记：旧库或别的程序的库，拒绝并要求显式迁移（空文件才允许初始化）。
        const objects = await database.objectNames();
        const foreignApplication =
          applicationId !== 0 && applicationId !== SESSION_PERSISTENCE_SQLITE_APPLICATION_ID;
        if (foreignApplication || objects.length > 0) {
          throw new Error(
            `session database at "${config.path}" has an unversioned schema or application identity`,
          );
        }
      }
    }

    const writeKey =
      config.type === "sqlite"
        ? `sqlite:${config.path}`
        : `postgres:${config.connectionString}:${schema}`;
    const inWrite = <T>(fn: (scoped: Database) => Promise<T>): Promise<T> =>
      enqueueWrite(writeKey, () => database.transaction(fn));

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
      if (config.type === "sqlite" && onDisk === 0) {
        await scoped.setSqlitePragma("application_id", SESSION_PERSISTENCE_SQLITE_APPLICATION_ID);
        await scoped.setSqlitePragma("user_version", SCHEMA_VERSION);
      }
      await ensureSchema(scoped, catalog);
      await runMigrations(scoped, {
        catalog,
        migrations: sessionMigrations(),
      });
      await backfillUsageTables(scoped);

      const state = persistenceState.table(scoped);
      await state.insertIgnore({ f_singleton: 1, f_store_id: randomUUID() }, ["f_singleton"]);
      for await (const row of state.select({ storeId: state.f_store_id })) storeId = row.storeId;
    });
    if (storeId === undefined || storeId.length === 0) {
      throw new Error("session database has no valid store identity");
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

/** 库文件身份：`file:dev:ino:birthtimeNs:store:<storeId>`（符号链接指向同一 inode 时身份相同）。 */
async function fileIdentity(path: string, storeId: string): Promise<string> {
  const identity = await stat(path, { bigint: true });
  return `file:${identity.dev}:${identity.ino}:${identity.birthtimeNs}:store:${storeId}`;
}

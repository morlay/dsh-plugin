import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { Pool, types as pgTypes, type PoolClient } from "pg";
import Cursor from "pg-cursor";
import { createDialect, type Dialect, type DialectName } from "./dialect.ts";
import type { TableDef } from "./defs.ts";
import { fragment, render, type Fragment } from "./fragment.ts";
import { createTableHandle, type TableHandle } from "./table.ts";
import { indexCatalog, type CatalogIndex } from "./catalog.ts";
import { classifyError } from "./error.ts";
import type { Catalog } from "./defs.ts";

/**
 * 注入给业务的库句柄：只回答「哪张表」与「怎么读/写/开事务」，不暴露方言、连接或 SQL。
 * 连接生命周期由创建它的一方（装配层）管理，业务拿到的是这个接口。
 */
export interface Database<C extends Catalog = Catalog> {
  /** 迁移 / 日志用；业务不需要读它。 */
  readonly dialect: Dialect;
  /** 装配层注册的 catalog（按表名解析；没注册时只能传定义）。 */
  readonly catalog: CatalogIndex;
  /** 按表名取（catalog 里有定义时保留强类型）。 */
  table<K extends C[number]["name"] & string>(
    name: K,
  ): TableHandle<Extract<C[number], { name: K }>>;
  /** 直接传定义（catalog 未注册时）。 */
  table<T extends TableDef>(definition: T): TableHandle<T>;
  /** 主读路径：按行流式迭代（与 Golang 的 `iter.Seq2` 对齐，不一次性物化大结果）。 */
  iterate<T>(query: Fragment): AsyncIterable<T>;
  /** 便捷读：把迭代器收成数组（报表 / 迁移读取用）。 */
  read<T>(query: Fragment): Promise<T[]>;
  /** 写入并拿回行（`RETURNING`；没有 RETURNING 的语句返回空数组）。 */
  write<T>(query: Fragment): Promise<T[]>;
  run(query: Fragment): Promise<void>;
  transaction<T>(fn: (database: Database<C>) => Promise<T>): Promise<T>;
  /** 现有的表与视图名（迁移探测旧表、拒绝别人的库都要它）。 */
  objectNames(): Promise<string[]>;
  /** 回收空间与统计（SQLite `VACUUM` / PostgreSQL `VACUUM ANALYZE`）；不得在事务内调用。 */
  vacuum(): Promise<void>;
  /** 读 SQLite 的 `PRAGMA`（其它方言直接报不支持）。 */
  sqlitePragma(name: SqlitePragmaName): Promise<string | number | undefined>;
  /** 写 SQLite 的 `PRAGMA`（值只允许安全字面量，见 `assertPragmaValue`）。 */
  setSqlitePragma(name: SqlitePragmaName, value: string | number): Promise<void>;
  close(): Promise<void>;
}

/** 业务侧用得到的 SQLite PRAGMA（库身份与日志模式；其余不开口子）。 */
export type SqlitePragmaName = "user_version" | "application_id" | "journal_mode";

function assertPragmaName(name: SqlitePragmaName): void {
  if (name !== "user_version" && name !== "application_id" && name !== "journal_mode") {
    throw new Error(`rdbkit: unsupported pragma '${String(name)}'`);
  }
}

/** PRAGMA 不支持绑定参数，值只能内联：只放行整数与标识符形状的字符串。 */
function assertPragmaValue(name: SqlitePragmaName, value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`rdbkit: invalid pragma value '${String(value)}' for '${name}'`);
    }
    return String(value);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`rdbkit: invalid pragma value '${value}' for '${name}'`);
  }
  return value;
}

export type OpenConfig =
  | {
      dialect: "sqlite";
      path: string;
      journalMode?: "wal" | "delete" | "truncate" | "persist";
      busyTimeout?: number;
      /** SQLite 页缓存（KB，负数表示 KB 数；不传用 SQLite 默认）。 */
      cacheSizeKb?: number;
      /** mmap 窗口（字节；0 关闭）。 */
      mmapSize?: number;
      /** 是否在打开时立即设置 `journal_mode`（默认 true；需要先校验库再切的调用方传 false）。 */
      applyJournalMode?: boolean;
    }
  | {
      dialect: "postgres";
      connectionString: string;
      schema?: string;
      /** 事务隔离级别（session-rdb 的写路径要 `serializable`）。 */
      isolationLevel?: "read committed" | "repeatable read" | "serializable";
    };

/** 一条已执行语句的观测（日志 / 慢查询 / 耗时统计）。 */
export interface QueryEvent {
  readonly dialect: DialectName;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly durationMs: number;
  readonly error?: unknown;
}

/** 打开时可带 catalog 与查询观测钩子。 */
export type OpenConfigWithCatalog<C extends Catalog = Catalog> = OpenConfig & {
  catalog?: C;
  onQuery?: (event: QueryEvent) => void;
};

/** 打开一个库；这是唯一创建连接的地方（连接管理留在这里，业务只拿 `Database`）。 */
export async function openDatabase<const C extends Catalog = Catalog>(
  config: OpenConfigWithCatalog<C>,
): Promise<Database<C>> {
  const catalog = indexCatalog(config.catalog ?? []);
  const database =
    config.dialect === "sqlite"
      ? await openSqlite(config, catalog, config.onQuery)
      : await openPostgres(config, catalog, config.onQuery);
  return database as Database<C>;
}

interface Executor {
  iterate(text: string, params: readonly unknown[]): AsyncIterable<unknown>;
  run(text: string, params: readonly unknown[]): Promise<void>;
  transaction<T>(fn: (executor: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * PostgreSQL 的 `bigint`（int8）与 `numeric` 默认由驱动给字符串。
 *
 * 值是 64 位整数时**不能用 Number 兜**（超过 `2^53` 就悄悄丢精度，`uint64` 的 ID 会撞车），所以：
 * - `int8`（OID 20）→ JS `BigInt`（精确，对应 Go 的 int64 / uint64）；
 * - `numeric`（OID 1700）保持驱动默认的字符串（可能是定点小数，BigInt 也不对）。
 *
 * 业务侧要 number 时自己 `Number(x)`（毫秒时间戳与计数在安全整数内，转换是安全的）。
 */
function bigintTypes(): {
  getTypeParser: (oid: number, format?: "text" | "binary") => (value: string) => unknown;
} {
  const INT8 = 20;
  return {
    getTypeParser(oid, format) {
      if (oid === INT8) {
        return (value: string) => (value === null ? null : BigInt(value));
      }
      const parser = pgTypes.getTypeParser(oid, format);
      return parser as (value: string) => unknown;
    },
  };
}

/**
 * 写通道串行：同一实例的事务与写语句排队执行（SQLite 是单连接，PG 的 serializable 并发会冲突）。
 * 用 `AsyncLocalStorage` 区分「当前异步上下文是否已在事务里」——只看计数器的话，并发调用会被误判成嵌套。
 */
function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

/** 保存点名：只在同一个事务里唯一即可。 */
let savepointCounter = 0;

function savepointName(): string {
  savepointCounter += 1;
  return `rdbkit_sp_${savepointCounter}`;
}

async function* iterateWrapped<T>(
  rows: AsyncIterable<unknown>,
  dialect: "sqlite" | "postgres",
): AsyncIterable<T> {
  try {
    for await (const row of rows) yield row as T;
  } catch (error) {
    throw classifyError(error, dialect);
  }
}

function createDatabase(
  dialect: Dialect,
  executor: Executor,
  catalog: CatalogIndex,
  onQuery?: (event: QueryEvent) => void,
): Database {
  const observe = async <T>(
    query: Fragment,
    run: (text: string, params: readonly unknown[]) => Promise<T>,
  ): Promise<T> => {
    const { text, params } = render(query, dialect.name);
    const started = performance.now();
    try {
      const result = await run(text, params);
      onQuery?.({
        dialect: dialect.name,
        sql: text,
        params,
        durationMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      onQuery?.({
        dialect: dialect.name,
        sql: text,
        params,
        durationMs: performance.now() - started,
        error,
      });
      throw classifyError(error, dialect.name);
    }
  };
  const database: Database = {
    dialect,
    catalog,
    table: (source: TableDef | string) => {
      const definition = typeof source === "string" ? catalog.get(source) : source;
      if (definition === undefined) {
        throw new Error(
          `rdbkit: no table '${typeof source === "string" ? source : source.name}' in catalog`,
        );
      }
      return createTableHandle(database, definition) as never;
    },
    iterate<T>(query: Fragment) {
      const { text, params } = render(query, dialect.name);
      return iterateWrapped<T>(executor.iterate(text, params), dialect.name);
    },
    read<T>(query: Fragment) {
      return observe(query, async () => {
        const rows: T[] = [];
        for await (const row of database.iterate<T>(query)) rows.push(row);
        return rows;
      });
    },
    write<T>(query: Fragment) {
      return database.read<T>(query);
    },
    run(query) {
      return observe(query, (text, params) => executor.run(text, params));
    },
    transaction(fn) {
      // catalog 跟着事务走：事务里按表名取句柄与外面一致。
      return executor.transaction((scoped) =>
        fn(createDatabase(dialect, scoped, catalog, onQuery)),
      );
    },
    async objectNames() {
      const query =
        dialect.name === "sqlite"
          ? fragment(
              "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
            )
          : fragment(
              "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()",
            );
      const rows = await database.read<{ name: string }>(query);
      return rows.map((row) => row.name);
    },
    async vacuum() {
      await database.run(fragment(dialect.name === "sqlite" ? "VACUUM" : "VACUUM ANALYZE"));
    },
    async sqlitePragma(name) {
      assertPragmaName(name);
      if (dialect.name !== "sqlite") {
        throw new Error(`rdbkit: '${name}' is a SQLite PRAGMA; this database is postgres`);
      }
      const rows = await database.read<Record<string, unknown>>(fragment(`PRAGMA ${name}`));
      const value = rows[0]?.[name];
      return typeof value === "number" || typeof value === "string" ? value : undefined;
    },
    async setSqlitePragma(name, value) {
      assertPragmaName(name);
      if (dialect.name !== "sqlite") {
        throw new Error(`rdbkit: '${name}' is a SQLite PRAGMA; this database is postgres`);
      }
      await database.run(fragment(`PRAGMA ${name} = ${assertPragmaValue(name, value)}`));
    },
    async close() {
      await executor.close();
    },
  };
  return database;
}

/** 把「已有执行面」包成 rdbkit 的 `Database`（宿主自己管连接与事务时用）。 */
export function wrapDatabase(
  dialectName: DialectName,
  ports: {
    iterate(text: string, params: readonly unknown[]): AsyncIterable<unknown>;
    run(text: string, params: readonly unknown[]): Promise<void>;
    /** 宿主自己管事务时提供：把当前事务的执行面做成 scoped `Database`（对应 Go 的 `Tx(ctx, fn)`）。 */
    transaction?: <T>(fn: (scoped: Database) => Promise<T>) => Promise<T>;
    close?(): Promise<void>;
  },
): Database {
  const database = createDatabase(
    createDialect(dialectName),
    {
      iterate: (text, params) => ports.iterate(text, params),
      run: (text, params) => ports.run(text, params),
      transaction: () => {
        throw new Error(
          "rdbkit: a wrapped database does not own transactions; use the host transaction",
        );
      },
      close: async () => {
        await ports.close?.();
      },
    },
    indexCatalog([]),
  );
  return ports.transaction === undefined
    ? database
    : { ...database, transaction: ports.transaction };
}

/** 结构迁移读取现状用的最小查询面。 */
export function shapeReader(database: Database): {
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
} {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return await database.read<T>(fragment(sql, params));
    },
  };
}

async function openSqlite(
  config: Extract<OpenConfig, { dialect: "sqlite" }>,
  catalog: CatalogIndex,
  onQuery?: (event: QueryEvent) => void,
): Promise<Database> {
  const client = new DatabaseSync(config.path);
  client.exec("PRAGMA foreign_keys = ON");
  client.exec(`PRAGMA busy_timeout = ${config.busyTimeout ?? 5000}`);
  if (config.cacheSizeKb !== undefined) client.exec(`PRAGMA cache_size = -${config.cacheSizeKb}`);
  if (config.mmapSize !== undefined) client.exec(`PRAGMA mmap_size = ${config.mmapSize}`);
  if (config.journalMode !== undefined && config.applyJournalMode !== false) {
    client.exec(`PRAGMA journal_mode = ${config.journalMode}`);
  }
  const enqueue = createSerialQueue();
  // 当前异步上下文所在的事务（嵌套时共享同一条连接）。
  const current = new AsyncLocalStorage<true>();
  const executor: Executor = {
    async *iterate(text, params) {
      // node:sqlite 的 `iterate` 是同步生成器：逐行读，不把结果集收成数组。
      for (const row of client.prepare(text).iterate(...(params as never[]))) yield row;
    },
    run(text, params) {
      const write = async (): Promise<void> => {
        client.prepare(text).run(...(params as never[]));
      };
      // 事务内的写就是这次事务的一部分；事务外的写先排队，免得落到别人的未提交事务里。
      return current.getStore() === true ? write() : enqueue(write);
    },
    transaction(fn) {
      if (current.getStore() === true) {
        // 嵌套：同一条连接上的保存点，内层失败只回滚内层。
        return (async () => {
          const name = savepointName();
          client.exec(`SAVEPOINT ${name}`);
          try {
            const result = await current.run(true, () => fn(executor));
            client.exec(`RELEASE SAVEPOINT ${name}`);
            return result;
          } catch (error) {
            client.exec(`ROLLBACK TO SAVEPOINT ${name}`);
            client.exec(`RELEASE SAVEPOINT ${name}`);
            throw error;
          }
        })();
      }
      return enqueue(async () => {
        client.exec("BEGIN IMMEDIATE");
        try {
          const result = await current.run(true, () => fn(executor));
          client.exec("COMMIT");
          return result;
        } catch (error) {
          client.exec("ROLLBACK");
          throw error;
        }
      });
    },
    async close() {
      await enqueue(async () => undefined);
      client.close();
    },
  };
  return createDatabase(createDialect("sqlite"), executor, catalog, onQuery);
}

async function openPostgres(
  config: Extract<OpenConfig, { dialect: "postgres" }>,
  catalog: CatalogIndex,
  onQuery?: (event: QueryEvent) => void,
): Promise<Database> {
  const pool = new Pool({ connectionString: config.connectionString, types: bigintTypes() });
  const enqueue = createSerialQueue();
  // 当前异步上下文所在的事务连接（嵌套时共享同一条连接，用保存点）。
  const current = new AsyncLocalStorage<PoolClient>();

  // 真游标：按 200 行一批从连接读，调用方提前 break 时释放。
  const cursorRows = async function* (
    client: PoolClient,
    text: string,
    params: readonly unknown[],
  ): AsyncIterable<unknown> {
    const cursor = client.query(new Cursor(text, params as never[]));
    try {
      for (;;) {
        const rows = (await cursor.read(200)) as unknown[];
        if (rows.length === 0) return;
        for (const row of rows) yield row;
      }
    } finally {
      await cursor.close().catch(() => undefined);
    }
  };

  const pooledIterate = async function* (
    text: string,
    params: readonly unknown[],
  ): AsyncIterable<unknown> {
    const client = await pool.connect();
    try {
      yield* cursorRows(client, text, params);
    } finally {
      client.release();
    }
  };

  /** 一条连接上的执行面（顶层事务与嵌套事务共用）。 */
  const scopeOf = (client: PoolClient): Executor => ({
    iterate: (text, params) => cursorRows(client, text, params),
    async run(text, params) {
      await client.query(text, params as never[]);
    },
    transaction(fn) {
      const name = savepointName();
      return (async () => {
        await client.query(`SAVEPOINT ${name}`);
        try {
          const result = await current.run(client, () => fn(scopeOf(client)));
          await client.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          await client.query(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      })();
    },
    async close() {
      // 连接由顶层事务释放，这里什么都不做。
    },
  });

  const executor: Executor = {
    iterate: pooledIterate,
    run(text, params) {
      const client = current.getStore();
      if (client !== undefined) {
        return client.query(text, params as never[]).then(() => undefined);
      }
      return enqueue(async () => {
        await pool.query(text, params as never[]);
      });
    },
    transaction(fn) {
      const held = current.getStore();
      if (held !== undefined) return scopeOf(held).transaction(fn);
      return enqueue(async () => {
        const client = await pool.connect();
        try {
          await client.query(
            config.isolationLevel === undefined
              ? "BEGIN"
              : `BEGIN ISOLATION LEVEL ${config.isolationLevel.toUpperCase()}`,
          );
          const result = await current.run(client, () => fn(scopeOf(client)));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      });
    },
    async close() {
      await enqueue(async () => undefined);
      await pool.end();
    },
  };
  return createDatabase(createDialect("postgres"), executor, catalog, onQuery);
}

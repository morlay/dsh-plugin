import type { Catalog, TableDef } from "../defs.ts";
import { createDialect, type Dialect } from "../dialect.ts";
import { render, type Fragment } from "../fragment.ts";
import { indexCatalog, type CatalogIndex } from "../catalog.ts";
import { createTableHandle } from "../table/handle.ts";
import { canceledError, classifyError } from "../error.ts";
import { explain, objectNames, setSqlitePragma, sqlitePragma, vacuum } from "./capabilities.ts";
import { applyIdentity, readIdentity, writeIdentity, type LibraryIdentity } from "./identity.ts";
import { openPostgres } from "./postgres.ts";
import { openSqlite } from "./sqlite.ts";
import type {
  Database,
  Executor,
  ExecutorOptions,
  OpenConfigWithCatalog,
  QueryEvent,
  QueryOptions,
} from "./types.ts";

// 打开时的 catalog：按表名建一次索引（之后 `table("名字")` 才解析得到）。
function withCatalog<C extends Catalog>(config: OpenConfigWithCatalog<C>): CatalogIndex {
  return indexCatalog(config.catalog ?? []);
}

// 打开一个库；这是连接创建的唯一入口（实际 connect 在 `sqlite.ts` / `postgres.ts`，业务只拿 `Database`）。
export async function openDatabase<const C extends Catalog = Catalog>(
  config: OpenConfigWithCatalog<C>,
): Promise<Database<C>> {
  const catalog = withCatalog(config);
  const executor = config.dialect === "sqlite" ? openSqlite(config) : openPostgres(config);
  // PostgreSQL 的目标 schema 只在这里定一次（缺省 public）；SQLite 没有 schema 概念。
  const database = createDatabase(createDialect(config.dialect), executor, catalog, {
    schema: config.dialect === "postgres" ? config.schema : undefined,
    onQuery: config.onQuery,
  }) as Database<C>;
  if (config.identity !== undefined) {
    try {
      await applyIdentity(database, config.identity);
    } catch (error) {
      // 身份不符时不给调用方一个半开的库：这里的句柄没人能拿去关。
      await database.close().catch(() => undefined);
      throw error;
    }
  }
  return database;
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

// 取消检查：语句前后与流式读的每一行之间（SQLite 的同步语句无法中途打断，这是它的上限）。
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw canceledError(signal.reason);
}

export function createDatabase(
  dialect: Dialect,
  executor: Executor,
  catalog: CatalogIndex,
  options: {
    schema?: string | undefined;
    onQuery?: ((event: QueryEvent) => void) | undefined;
  } = {},
): Database {
  const { onQuery } = options;
  const schema = dialect.name === "postgres" ? (options.schema ?? "public") : undefined;
  // 片段渲染出的执行提示：BigInt 读取与调用方的取消信号。
  const hintsOf = (
    readBigInts: boolean,
    signal: AbortSignal | undefined,
  ): ExecutorOptions | undefined => {
    if (!readBigInts && signal === undefined) return undefined;
    return { readBigInts, ...(signal === undefined ? {} : { signal }) };
  };
  const observe = async <T>(
    query: Fragment,
    queryOptions: QueryOptions | undefined,
    run: (
      text: string,
      params: readonly unknown[],
      hints: ExecutorOptions | undefined,
    ) => Promise<T>,
  ): Promise<T> => {
    const rendered = render(query, dialect.name);
    const hints = hintsOf(rendered.readBigInts, queryOptions?.signal);
    const started = performance.now();
    try {
      throwIfAborted(queryOptions?.signal);
      const result = await run(rendered.text, rendered.params, hints);
      throwIfAborted(queryOptions?.signal);
      onQuery?.({
        dialect: dialect.name,
        sql: rendered.text,
        params: rendered.params,
        durationMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      onQuery?.({
        dialect: dialect.name,
        sql: rendered.text,
        params: rendered.params,
        durationMs: performance.now() - started,
        error,
      });
      throw classifyError(error, dialect.name);
    }
  };
  // 流式读的观测：完成、出错或调用方提前 break 都发一条（带实际消费的行数）。
  const observeStream = async function* <T>(
    query: Fragment,
    queryOptions: QueryOptions | undefined,
  ): AsyncIterable<T> {
    const rendered = render(query, dialect.name);
    const started = performance.now();
    let rows = 0;
    let failure: unknown;
    try {
      throwIfAborted(queryOptions?.signal);
      const source = executor.iterate(
        rendered.text,
        rendered.params,
        hintsOf(rendered.readBigInts, queryOptions?.signal),
      );
      for await (const row of source) {
        throwIfAborted(queryOptions?.signal);
        rows += 1;
        yield row as T;
      }
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      onQuery?.({
        dialect: dialect.name,
        sql: rendered.text,
        params: rendered.params,
        durationMs: performance.now() - started,
        rows,
        ...(failure === undefined ? {} : { error: failure }),
      });
    }
  };
  const database: Database = {
    dialect,
    catalog,
    schema,
    table: (source: TableDef | string) => {
      const definition = typeof source === "string" ? catalog.get(source) : source;
      if (definition === undefined) {
        throw new Error(
          `zephyr-rdb: no table '${typeof source === "string" ? source : source.name}' in catalog`,
        );
      }
      return createTableHandle(database, definition) as never;
    },
    iterate<T>(query: Fragment, queryOptions?: QueryOptions) {
      return iterateWrapped<T>(observeStream<T>(query, queryOptions), dialect.name);
    },
    async read<T>(query: Fragment, queryOptions?: QueryOptions) {
      const rows: T[] = [];
      for await (const row of database.iterate<T>(query, queryOptions)) rows.push(row);
      return rows;
    },
    // 写通道：与 `run` 同一队列（事务外串行、事务内走事务连接），行来自 `RETURNING`。
    write<T>(query: Fragment, queryOptions?: QueryOptions) {
      return observe(query, queryOptions, async (text, params, hints) => {
        const rows = await executor.write(text, params, hints);
        return rows as T[];
      });
    },
    run(query, queryOptions) {
      return observe(query, queryOptions, (text, params) => executor.run(text, params));
    },
    transaction(fn, queryOptions) {
      // catalog 跟着事务走：事务里按表名取句柄与外面一致。
      // 关闭状态与取消都是同步检查，这里统一转成 rejected：调用方按 `await` / `rejects` 判定一种形状。
      return Promise.resolve().then(() => {
        throwIfAborted(queryOptions?.signal);
        return executor.transaction((scoped) =>
          fn(createDatabase(dialect, scoped, catalog, { schema, onQuery })),
        );
      });
    },
    explain: (query) => explain(database, query),
    readIdentity: () => readIdentity(database),
    writeIdentity: (identity: LibraryIdentity) => writeIdentity(database, identity),
    objectNames: () => objectNames(database),
    vacuum: () => vacuum(database),
    sqlitePragma: (name) => sqlitePragma(database, name),
    setSqlitePragma: (name, value) => setSqlitePragma(database, name, value),
    async close() {
      await executor.close();
    },
  };
  return database;
}

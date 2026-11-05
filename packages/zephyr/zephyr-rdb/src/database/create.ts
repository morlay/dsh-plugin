import type { Catalog, TableDef } from "../defs.ts";
import { createDialect, type Dialect } from "../dialect.ts";
import { render, type Fragment } from "../fragment.ts";
import { indexCatalog, type CatalogIndex } from "../catalog.ts";
import { createTableHandle } from "../table/handle.ts";
import { classifyError } from "../error.ts";
import { objectNames, setSqlitePragma, sqlitePragma, vacuum } from "./capabilities.ts";
import { openPostgres } from "./postgres.ts";
import { openSqlite } from "./sqlite.ts";
import type { Database, Executor, OpenConfigWithCatalog, QueryEvent } from "./types.ts";

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
  return createDatabase(createDialect(config.dialect), executor, catalog, {
    schema: config.dialect === "postgres" ? config.schema : undefined,
    onQuery: config.onQuery,
  }) as Database<C>;
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
        fn(createDatabase(dialect, scoped, catalog, { schema, onQuery })),
      );
    },
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

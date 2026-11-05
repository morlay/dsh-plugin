import { createDialect, type DialectName } from "../dialect.ts";
import { fragment } from "../fragment.ts";
import { indexCatalog } from "../catalog.ts";
import { createDatabase } from "./create.ts";
import type { Database } from "./types.ts";

// 把「已有执行面」包成本包的 `Database`（宿主自己管连接与事务时用）。
export function wrapDatabase(
  dialectName: DialectName,
  ports: {
    // 宿主连接的目标 schema（PostgreSQL；省略即 public，与本包默认一致）。
    schema?: string | undefined;
    iterate(text: string, params: readonly unknown[]): AsyncIterable<unknown>;
    run(text: string, params: readonly unknown[]): Promise<void>;
    // 宿主自己管事务时提供：把当前事务的执行面做成 scoped `Database`（对应 Go 的 `Tx(ctx, fn)`）。
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
          "zephyr-rdb: a wrapped database does not own transactions; use the host transaction",
        );
      },
      close: async () => {
        await ports.close?.();
      },
    },
    indexCatalog([]),
    { schema: ports.schema },
  );
  return ports.transaction === undefined
    ? database
    : { ...database, transaction: ports.transaction };
}

// 结构迁移读取现状用的最小查询面。
export function shapeReader(database: Database): {
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
} {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return await database.read<T>(fragment(sql, params));
    },
  };
}

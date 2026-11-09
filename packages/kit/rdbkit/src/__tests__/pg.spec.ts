import { describe, expect, it } from "vitest";
import { createPostgresTestDatabase, type PostgresTestDatabase } from "../testing.ts";
import {
  count,
  defineCatalog,
  defineTable,
  ensureSchema,
  fragment,
  openDatabase,
  runMigrations,
  sum,
  type Database,
} from "../index.ts";

const items = defineTable({
  name: "t_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
    f_count: { type: "integer", notNull: true, default: 0 },
    f_active: { type: "boolean", notNull: true, default: 1 },
    // `bigint` 在 PostgreSQL 上默认由驱动给字符串；rdbkit 的值类型是 bigint（BigInt），要有用例盯住。
    f_at: { type: "bigint", notNull: true, default: 0 },
  },
  indexes: { idx_items_owner: { columns: ["f_owner"] } },
});

const parts = defineTable({
  name: "t_parts",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
    f_amount: { type: "integer", notNull: true },
    // `SUM(bigint)` 在 PostgreSQL 上返回 numeric（驱动给字符串），rdbkit 的 sum 要 cast 回 int8。
    f_big: { type: "bigint", notNull: true, default: 0 },
  },
});

describe.skipIf(!process.env.TEST_PG_URL)("PostgreSQL 上同一套构建", () => {
  it("建表 / 投影聚合 / join / 批量插入 / 事务回滚 / 迁移差异", async () => {
    const testDatabase: PostgresTestDatabase = await createPostgresTestDatabase();
    const database = await openDatabase({
      dialect: "postgres",
      connectionString: testDatabase.connectionString,
      catalog: defineCatalog([items, parts]),
    });
    try {
      const statements = await ensureSchema(database, [items, parts]);
      expect(
        statements.some((statement) =>
          statement.includes('CREATE TABLE IF NOT EXISTS "public"."t_items"'),
        ),
      ).toBe(true);
      expect(
        statements.some((statement) =>
          statement.includes('CREATE TABLE IF NOT EXISTS "public"."t_parts"'),
        ),
      ).toBe(true);
      // 幂等
      expect(await ensureSchema(database, [items, parts])).toEqual([]);

      const table = database.table("t_items");
      const partTable = database.table("t_parts");
      const [created] = await table.insert({ f_owner: "a", f_count: 1, f_at: 1_788_852_417_123 }, [
        "f_id",
        "f_owner",
        "f_at",
      ]);
      expect(created).toMatchObject({ f_owner: "a" });
      // 64 位整数读回来是 BigInt：超过 2^53 的 uint64 / int64 不会丢精度。
      expect(created?.f_at).toBe(1_788_852_417_123n);
      await table.insertMany([{ f_owner: "b", f_count: 2 }]);
      await partTable.insertMany([
        { f_owner: "a", f_amount: 5, f_big: 5_000_000_000n },
        { f_owner: "a", f_amount: 6, f_big: 6n },
      ]);

      const totals: { owner: string; total: number | bigint; big: number | bigint }[] = [];
      for await (const row of table
        .select({
          owner: table.column("f_owner"),
          total: sum("f_amount", "t_parts"),
          big: sum("f_big", "t_parts"),
        })
        .join(parts, fragment('"t_parts"."f_owner" = "t_items"."f_owner"'))
        .groupBy("f_owner")
        .orderBy("f_owner")) {
        totals.push(row);
      }
      // PostgreSQL 的 SUM 返回 int8 → BigInt；`SUM(bigint)` 是 numeric，sum() 会 cast 回 int8。
      expect(totals).toEqual([{ owner: "a", total: 11n, big: 5_000_000_006n }]);

      // 真游标：逐行读，提前 break 也要把连接还回去（再开新查询不挂）。
      const streamed: string[] = [];
      for await (const row of table.select({ owner: table.column("f_owner") }).orderBy("f_owner")) {
        streamed.push(row.owner);
        break;
      }
      expect(streamed).toEqual(["a"]);

      const [before] = await collect(table.select({ n: count() }));
      expect(Number(before?.n)).toBe(2);

      await expect(
        database.transaction(async (tx) => {
          await tx.table("t_items").insert({ f_owner: "c" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const [after] = await collect(table.select({ n: count() }));
      expect(Number(after?.n)).toBe(2);
    } finally {
      await database.close();
      await testDatabase.drop();
    }
  });

  it("自定义 schema：DDL / 读写 / 迁移账本 / 结构探测都在同一处，public 不留副本", async () => {
    const testDatabase: PostgresTestDatabase = await createPostgresTestDatabase();
    const catalog = defineCatalog([items, parts]);
    const config = {
      dialect: "postgres" as const,
      connectionString: testDatabase.connectionString,
      schema: "dsh_test",
      catalog,
    };
    const migration = {
      id: "20261109-pg-schema-probe",
      up: async (tx: Database) => {
        await tx.table("t_items").insert({ f_owner: "migrated" });
      },
    };

    const database = await openDatabase(config);
    try {
      await database.run(fragment('CREATE SCHEMA IF NOT EXISTS "dsh_test"'));

      // 结构：建表与索引都限定到配置的 schema，且重复对齐是幂等的。
      const statements = await ensureSchema(database, [items, parts]);
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.every((statement) => statement.includes('"dsh_test".'))).toBe(true);
      expect(await ensureSchema(database, [items, parts])).toEqual([]);

      // 读写：句柄不依赖连接串的 search_path，直接落在配置的 schema。
      const table = database.table("t_items");
      await table.insert({ f_owner: "a", f_count: 1 });
      const owners = await collect(table.select({ owner: table.column("f_owner") }));
      expect(owners).toEqual([{ owner: "a" }]);

      // 迁移账本：建表、读、记账都在同一 schema，重跑只跑没记过的。
      expect(await runMigrations(database, { catalog, migrations: [migration] })).toEqual([
        migration.id,
      ]);
      expect(await runMigrations(database, { catalog, migrations: [migration] })).toEqual([]);
      const ledger = await database.read<{ f_id: string }>(
        fragment('SELECT f_id FROM "dsh_test"."t_schema_migrations"'),
      );
      expect(ledger.map((row) => row.f_id)).toEqual([migration.id]);

      // 结构探测跟着配置的 schema（旧数据迁移靠它判旧表在不在）。
      expect(await database.objectNames()).toEqual(
        expect.arrayContaining(["t_items", "t_schema_migrations"]),
      );

      // 表与账本都在 dsh_test，public 不留副本。
      const placements = await database.read<{ table_schema: string; table_name: string }>(
        fragment(
          "SELECT table_schema, table_name FROM information_schema.tables " +
            "WHERE table_name IN ('t_items', 't_parts', 't_schema_migrations') ORDER BY table_name",
        ),
      );
      expect(placements.map((row) => `${row.table_schema}.${row.table_name}`)).toEqual([
        "dsh_test.t_items",
        "dsh_test.t_parts",
        "dsh_test.t_schema_migrations",
      ]);
    } finally {
      await database.close();
    }

    // 再次打开：结构已对齐、迁移已记账，数据还在。
    const reopened = await openDatabase(config);
    try {
      expect(await ensureSchema(reopened, [items, parts])).toEqual([]);
      expect(await runMigrations(reopened, { catalog, migrations: [migration] })).toEqual([]);
      const [total] = await collect(reopened.table("t_items").select({ n: count() }));
      expect(Number(total?.n)).toBe(2);
    } finally {
      await reopened.close();
      await testDatabase.drop();
    }
  });
});

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

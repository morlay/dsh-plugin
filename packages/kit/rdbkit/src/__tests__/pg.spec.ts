import { describe, expect, it } from "vitest";
import {
  createPostgresTestDatabase,
  type PostgresTestDatabase,
} from "../testing.ts";
import {
  count,
  defineCatalog,
  defineTable,
  ensureSchema,
  fragment,
  openDatabase,
  sum,
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
      const [created] = await table.insert(
        { f_owner: "a", f_count: 1, f_at: 1_788_852_417_123 },
        ["f_id", "f_owner", "f_at"],
      );
      expect(created).toMatchObject({ f_owner: "a" });
      // 64 位整数读回来是 BigInt：超过 2^53 的 uint64 / int64 不会丢精度。
      expect(created?.f_at).toBe(1_788_852_417_123n);
      await table.insertMany([{ f_owner: "b", f_count: 2 }]);
      await partTable.insertMany([
        { f_owner: "a", f_amount: 5 },
        { f_owner: "a", f_amount: 6 },
      ]);

      const totals: { owner: string; total: number | bigint }[] = [];
      for await (const row of table
        .select({ owner: table.column("f_owner"), total: sum("f_amount", "t_parts") })
        .join(parts, fragment('"t_parts"."f_owner" = "t_items"."f_owner"'))
        .groupBy("f_owner")
        .orderBy("f_owner")) {
        totals.push(row);
      }
      // PostgreSQL 的 SUM 返回 int8 → BigInt。
      expect(totals).toEqual([{ owner: "a", total: 11n }]);

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
});

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

import { describe, expect, it } from "vitest";
import { count, defineTable, E, ensureSchema, openDatabase } from "../index.ts";

const rows = defineTable({
  name: "t_tx_rows",
  columns: {
    f_id: { type: "text", primaryKey: true, notNull: true },
    f_value: { type: "integer", notNull: true, default: 0 },
  },
});

async function freshDatabase(): Promise<Awaited<ReturnType<typeof openDatabase>>> {
  const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
  await ensureSchema(database, [rows]);
  return database;
}

async function countRows(
  database: Awaited<ReturnType<typeof openDatabase>>,
): Promise<number> {
  const table = database.table(rows);
  let total = 0;
  for await (const row of table.select({ n: count() })) total = Number(row.n);
  return total;
}

describe("事务通道", () => {
  it("并发事务各自完整：不出现「事务中再开事务」", async () => {
    const database = await freshDatabase();
    try {
      const table = database.table(rows);
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          database.transaction(async (tx) => {
            await tx.table(rows).insert({ f_id: `row-${index}`, f_value: index });
          }),
        ),
      );
      expect(await countRows(database)).toBe(20);
      expect(table.name).toBe("t_tx_rows");
    } finally {
      await database.close();
    }
  });

  it("事务内再开事务走保存点：内层失败只回滚内层", async () => {
    const database = await freshDatabase();
    try {
      await database.transaction(async (tx) => {
        await tx.table(rows).insert({ f_id: "outer", f_value: 1 });
        await expect(
          database.transaction(async (inner) => {
            await inner.table(rows).insert({ f_id: "inner", f_value: 2 });
            throw new Error("inner failed");
          }),
        ).rejects.toThrow("inner failed");
        await tx.table(rows).insert({ f_id: "outer-2", f_value: 3 });
      });
      const ids: string[] = [];
      for await (const row of database.table(rows).select({ id: E.column("f_id") }).orderBy("f_id")) {
        ids.push(row.id);
      }
      expect(ids).toEqual(["outer", "outer-2"]);
    } finally {
      await database.close();
    }
  });

  it("事务内的写与事务同生共死", async () => {
    const database = await freshDatabase();
    try {
      await expect(
        database.transaction(async (tx) => {
          await tx.table(rows).insert({ f_id: "rolled-back", f_value: 1 });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await countRows(database)).toBe(0);
    } finally {
      await database.close();
    }
  });
});

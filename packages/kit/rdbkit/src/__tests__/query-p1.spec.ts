import { describe, expect, it } from "vitest";
import {
  column,
  defineTable,
  ensureSchema,
  eq,
  forUpdate,
  fragment,
  gt,
  openDatabase,
  render,
  union,
  value,
  withCtes,
  type QueryEvent,
} from "../index.ts";

const items = defineTable({
  name: "t_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_key: { type: "text", notNull: true, unique: true },
    f_count: { type: "integer", notNull: true, default: 0 },
  },
});

describe("P1：join 变体 / CTE / UNION / 行锁 / 查询观测", () => {
  it("join 变体与别名、CTE、UNION 的 SQL 形状（两方言）", () => {
    const table = defineTable(items);
    const query = { table } as never;
    void query;
    const left = fragment('SELECT "f_id" FROM "t_items" WHERE "f_count" > ?', [1]);
    const right = fragment('SELECT "f_id" FROM "t_items" WHERE "f_count" > ?', [2]);
    expect(render(union(left, right), "sqlite")).toEqual({
      text: 'SELECT "f_id" FROM "t_items" WHERE "f_count" > ? UNION SELECT "f_id" FROM "t_items" WHERE "f_count" > ?',
      params: [1, 2],
    });
    expect(render(union(left, right, { all: true }), "postgres").text).toContain("UNION ALL");

    const cte = withCtes(
      [{ name: "recent", query: left }],
      fragment('SELECT "f_id" FROM "recent"'),
    );
    expect(render(cte, "postgres").text).toBe(
      'WITH "recent" AS ( SELECT "f_id" FROM "t_items" WHERE "f_count" > $1 ) SELECT "f_id" FROM "recent"',
    );

    // 行锁只有 PostgreSQL 认：SQLite 渲染时整段丢掉（参数也不留）。
    expect(render(forUpdate({ skipLocked: true }), "sqlite")).toEqual({ text: "", params: [] });
    expect(render(forUpdate({ skipLocked: true }), "postgres").text).toBe("FOR UPDATE SKIP LOCKED");
  });

  it("实跑：join 别名、CTE、UNION、查询观测", async () => {
    const events: QueryEvent[] = [];
    const database = await openDatabase({
      dialect: "sqlite",
      path: ":memory:",
      onQuery: (event) => events.push(event),
    });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await table.insertMany([
        { f_key: "a", f_count: 1 },
        { f_key: "b", f_count: 2 },
      ]);

      // join 别名 + 左连接
      const rows: { key: string; other: string | null }[] = [];
      for await (const row of table
        .select({ key: table.column("f_key"), other: column("f_key", "o") })
        .join(items, eq(column("f_id", "o"), column("f_id", "t_items")), "left", "o")
        .orderBy("f_key")) {
        rows.push(row as never);
      }
      expect(rows.map((row) => row.key)).toEqual(["a", "b"]);

      // CTE + 主查询
      const cte = withCtes(
        [{ name: "recent", query: table.select({ id: table.column("f_id") }).toFragment() }],
        fragment('SELECT "id" FROM "recent" ORDER BY "id"'),
      );
      const ids = await database.read<{ id: number }>(cte);
      expect(ids.map((row) => row.id)).toEqual([1, 2]);

      // UNION
      const merged = await database.read<{ id: number }>(
        union(
          table
            .select({ id: table.column("f_id") })
            .where(gt(column("f_count"), value(1)))
            .toFragment(),
          table
            .select({ id: table.column("f_id") })
            .where(eq(column("f_key"), value("a")))
            .toFragment(),
        ),
      );
      expect(new Set(merged.map((row) => row.id))).toEqual(new Set([1, 2]));

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toMatchObject({ dialect: "sqlite" });
      expect(typeof events[0]?.durationMs).toBe("number");
    } finally {
      await database.close();
    }
  });
});

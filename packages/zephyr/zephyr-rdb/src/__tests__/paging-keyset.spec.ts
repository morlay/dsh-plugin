import { describe, expect, it } from "vitest";
import {
  defineTable,
  ensureSchema,
  fragment,
  keysetAfter,
  openDatabase,
  render,
  withCtes,
} from "@morlay/zephyr-rdb";

const rows = defineTable({
  name: "t_rows",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_n: { type: "integer", notNull: true },
  },
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of source) result.push(row);
  return result;
}

describe("keyset 分页", () => {
  it("定位条件是行值比较，占位符按方言编号", () => {
    expect(render(keysetAfter(["f_id"], [3]), "sqlite")).toEqual({
      text: '("f_id") > (?)',
      params: [3],
      readBigInts: false,
    });
    expect(render(keysetAfter(["f_owner", "f_id"], ["a", 3]), "postgres")).toEqual({
      text: '("f_owner", "f_id") > ($1, $2)',
      params: ["a", 3],
      readBigInts: false,
    });
    expect(() => keysetAfter(["f_id"], [])).toThrow(/same number/u);
  });

  it("实跑：逐页取完与 OFFSET 分页给同一批行（SQLite）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [rows]);
      const table = database.table(rows);
      await table.insertMany([1, 2, 3, 4, 5].map((n) => ({ f_n: n })));

      const pageSize = 2;
      const seen: number[] = [];
      let last: number | undefined;
      for (;;) {
        const query = table.select({ n: table.f_n }).orderBy("f_n").limit(pageSize);
        if (last !== undefined) query.where(keysetAfter([table.f_n], [last]));
        const page = await collect(query);
        if (page.length === 0) break;
        seen.push(...page.map((row) => row.n));
        last = page[page.length - 1]?.n;
        if (page.length < pageSize) break;
      }
      expect(seen).toEqual([1, 2, 3, 4, 5]);

      // 同一批行：OFFSET 分页给同样的顺序（keyset 只是不扫前面的行）。
      const offsetRows = await collect(
        table.select({ n: table.f_n }).orderBy("f_n").limit(5).offset(0),
      );
      expect(offsetRows.map((row) => row.n)).toEqual(seen);
    } finally {
      await database.close();
    }
  });
});

describe("递归 CTE", () => {
  it("withCtes 的 recursive 渲染成 WITH RECURSIVE，两方言一致", () => {
    const cte = {
      name: "counter",
      columns: ["i"],
      recursive: true,
      query: fragment('SELECT 1 UNION ALL SELECT "i" + 1 FROM "counter" WHERE "i" < 3'),
    };
    for (const dialect of ["sqlite", "postgres"] as const) {
      const sql = render(withCtes([cte], fragment('SELECT "i" FROM "counter"')), dialect);
      expect(sql.text).toContain('WITH RECURSIVE "counter" ("i") AS (');
      expect(sql.text).toContain('SELECT "i" FROM "counter"');
    }
  });

  it("实跑：递归序列 1..3（SQLite）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      const cte = {
        name: "counter",
        columns: ["i"],
        recursive: true,
        query: fragment('SELECT 1 UNION ALL SELECT "i" + 1 FROM "counter" WHERE "i" < 3'),
      };
      const result = await database.read<{ i: number }>(
        withCtes([cte], fragment('SELECT "i" FROM "counter" ORDER BY "i"')),
      );
      expect(result.map((row) => row.i)).toEqual([1, 2, 3]);
    } finally {
      await database.close();
    }
  });
});

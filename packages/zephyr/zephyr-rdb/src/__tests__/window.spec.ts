import { describe, expect, it } from "vitest";
import {
  defineTable,
  ensureSchema,
  lag,
  openDatabase,
  rank,
  render,
  rowNumber,
  wrapDatabase,
  type Database,
} from "@morlay/zephyr-rdb";

const scores = defineTable({
  name: "t_scores",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
    f_amount: { type: "integer", notNull: true },
  },
});

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

// 记录语句的假 PostgreSQL 执行面：窗口函数的 SQL 形状不需要真库。
function recordingPostgres(): Database {
  let database!: Database;
  database = wrapDatabase("postgres", {
    async *iterate() {
      yield* [] as unknown[];
    },
    async run() {},
    transaction: (fn) => fn(database),
  });
  return database;
}

describe("窗口函数", () => {
  it("同一份写法在两方言渲染成同一份 OVER 子句，占位符各自编号", () => {
    const database = recordingPostgres();
    const table = database.table(scores);
    const query = table.select({
      owner: table.f_owner,
      rn: rowNumber({
        partitionBy: [table.f_owner],
        orderBy: [{ column: table.f_amount, direction: "desc" }],
      }),
      rnk: rank({ orderBy: [{ column: table.f_amount }] }),
      previous: lag(table.f_amount, { offset: 2, fallback: 0 }),
    });

    const postgres = render(query.toFragment(), "postgres");
    expect(postgres.text).toContain(
      'ROW_NUMBER() OVER (PARTITION BY "t_scores"."f_owner" ORDER BY "t_scores"."f_amount" DESC) AS "rn"',
    );
    expect(postgres.text).toContain('RANK() OVER (ORDER BY "t_scores"."f_amount" ASC) AS "rnk"');
    expect(postgres.text).toContain('LAG("t_scores"."f_amount", $1, $2) AS "previous"');
    expect(postgres.params).toEqual([2, 0]);

    const sqlite = render(query.toFragment(), "sqlite");
    expect(sqlite.text).toContain('LAG("t_scores"."f_amount", ?, ?) AS "previous"');
    expect(sqlite.params).toEqual([2, 0]);
  });

  it("实跑：分区行号 / 名次 / 上一行（SQLite）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [scores]);
      const table = database.table(scores);
      await table.insertMany([
        { f_owner: "a", f_amount: 10 },
        { f_owner: "a", f_amount: 30 },
        { f_owner: "b", f_amount: 20 },
      ]);

      const rows = await collect(
        table
          .select({
            owner: table.f_owner,
            amount: table.f_amount,
            rn: rowNumber({ partitionBy: [table.f_owner], orderBy: [{ column: table.f_amount }] }),
            rnk: rank({ orderBy: [{ column: table.f_amount, direction: "desc" }] }),
            previous: lag(table.f_amount, {
              partitionBy: [table.f_owner],
              orderBy: [{ column: table.f_amount }],
            }),
          })
          .orderBy("f_owner")
          .orderBy("f_amount"),
      );
      expect(rows.map((row) => [row.owner, row.amount, row.rn, row.rnk, row.previous])).toEqual([
        ["a", 10, 1, 3, null],
        ["a", 30, 2, 1, 10],
        ["b", 20, 1, 2, null],
      ]);
    } finally {
      await database.close();
    }
  });
});

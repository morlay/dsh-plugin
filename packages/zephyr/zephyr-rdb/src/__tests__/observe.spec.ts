import { describe, expect, test } from "@morlay/zephyr/testing";
import {
  DbError,
  defineTable,
  ensureSchema,
  fragment,
  openDatabase,
  wrapDatabase,
  type Database,
  type QueryEvent,
} from "@morlay/zephyr-rdb";

const items = defineTable({
  name: "t_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
  },
});

describe("查询观测", () => {
  test("流式读在完成、提前 break、出错时各发一条事件（带实际消费行数）", async () => {
    const events: QueryEvent[] = [];
    const database = await openDatabase({
      dialect: "sqlite",
      path: ":memory:",
      onQuery: (event) => events.push(event),
    });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await table.insertMany([{ f_owner: "a" }, { f_owner: "b" }]);
      events.length = 0;

      // 完整消费
      await database.read(fragment('SELECT "f_owner" FROM "t_items" ORDER BY "f_owner"'));
      // 提前 break：事件仍然发出，行数是实际消费的
      for await (const row of database.iterate(
        fragment('SELECT "f_owner" FROM "t_items" ORDER BY "f_owner"'),
      )) {
        void row;
        break;
      }
      // 出错：事件带 error，行数是出错前消费的行数
      await expect(
        database.read(fragment('SELECT "f_owner" FROM "t_missing"')),
      ).rejects.toBeInstanceOf(DbError);

      expect(events.map((event) => [event.rows, event.error !== undefined])).toEqual([
        [2, false],
        [1, false],
        [0, true],
      ]);
      expect(events.every((event) => event.durationMs >= 0)).toBe(true);
    } finally {
      await database.close();
    }
  });

  test("EXPLAIN 返回计划行数组（SQLite 取 detail）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      const plan = await database.explain(fragment('SELECT * FROM "t_items"'));
      expect(plan.length).toBeGreaterThan(0);
      expect(plan.join("\n")).toMatch(/SCAN|SEARCH/u);
    } finally {
      await database.close();
    }
  });

  test("EXPLAIN 在 PostgreSQL 上取 QUERY PLAN 列并带方言前缀", async () => {
    const statements: string[] = [];
    let database!: Database;
    database = wrapDatabase("postgres", {
      async *iterate(text) {
        statements.push(text);
        yield { "QUERY PLAN": "Seq Scan on t_items" };
      },
      async run() {},
      transaction: (fn) => fn(database),
    });
    await expect(database.explain(fragment('SELECT * FROM "t_items"'))).resolves.toEqual([
      "Seq Scan on t_items",
    ]);
    expect(statements[0]).toBe('EXPLAIN (FORMAT TEXT) SELECT * FROM "t_items"');
  });
});

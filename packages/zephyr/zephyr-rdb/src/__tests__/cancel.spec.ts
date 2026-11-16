import { describe, expect, it } from "vitest";
import { defineTable, ensureSchema, fragment, openDatabase } from "@morlay/zephyr-rdb";

const items = defineTable({
  name: "t_items",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_owner: { type: "text", notNull: true },
  },
});

describe("取消", () => {
  it("已取消的信号在语句执行前就抛 canceled（read / run / transaction）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      const controller = new AbortController();
      controller.abort();
      const signal = controller.signal;
      await expect(database.read(fragment("SELECT 1"), { signal })).rejects.toMatchObject({
        kind: "canceled",
        code: "ABORT_ERR",
      });
      await expect(database.run(fragment("SELECT 1"), { signal })).rejects.toMatchObject({
        kind: "canceled",
      });
      await expect(database.transaction(async () => undefined, { signal })).rejects.toMatchObject({
        kind: "canceled",
      });
    } finally {
      await database.close();
    }
  });

  it("迭代中途取消：下一次 next 抛 canceled，事件记为出错（SQLite 在行之间检查）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [items]);
      const table = database.table(items);
      await table.insertMany([{ f_owner: "a" }, { f_owner: "b" }]);

      const controller = new AbortController();
      const iterator = database
        .iterate(fragment('SELECT "f_owner" FROM "t_items" ORDER BY "f_owner"'), {
          signal: controller.signal,
        })
        [Symbol.asyncIterator]();
      expect((await iterator.next()).value).toEqual({ f_owner: "a" });
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({ kind: "canceled", code: "ABORT_ERR" });
    } finally {
      await database.close();
    }
  });
});

describe.skipIf(!process.env.TEST_PG_URL)("取消（PostgreSQL）", () => {
  it("执行中的语句被真正取消：语句抛 canceled，连接随后仍可用", async () => {
    const database = await openDatabase({
      dialect: "postgres",
      connectionString: process.env.TEST_PG_URL as string,
    });
    try {
      const controller = new AbortController();
      const pending = database.read(fragment("SELECT pg_sleep(5)"), {
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 200);
      await expect(pending).rejects.toMatchObject({ kind: "canceled" });
      // 取消后连接没有被拖死：下一条语句正常返回。
      const rows = await database.read<{ ok: number }>(fragment("SELECT 1 AS ok"));
      expect(rows).toEqual([{ ok: 1 }]);
    } finally {
      await database.close();
    }
  });
});

import { describe, expect, test } from "@morlay/zephyr/testing";
import { defineTable, ensureSchema, fragment, openDatabase } from "@morlay/zephyr-rdb";

const readings = defineTable({
  name: "t_readings",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_note: { type: "text", notNull: true },
  },
});

describe("生命周期", () => {
  test("close 幂等：连关两次不抛", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    await database.close();
    await expect(database.close()).resolves.toBeUndefined();
  });

  test("关闭后的查询与事务抛带 code 的 DbError（kind 是 closed）", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    await ensureSchema(database, [readings]);
    const table = database.table(readings);
    await database.close();

    await expect(database.read(fragment("SELECT 1"))).rejects.toMatchObject({
      kind: "closed",
      code: "ZEPHYR_RDB_CLOSED",
    });
    await expect(table.insert({ f_note: "x" })).rejects.toMatchObject({ kind: "closed" });
    await expect(database.transaction(async () => undefined)).rejects.toMatchObject({
      kind: "closed",
    });
    // 迭代器在第一次 next() 时报 closed，不是驱动裸错。
    const iterator = table.select({ note: table.f_note })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ kind: "closed" });
  });

  test("iterate 未消费完时 close 在超时内返回，下一次 next 抛 closed", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    await ensureSchema(database, [readings]);
    const table = database.table(readings);
    await table.insertMany([{ f_note: "a" }, { f_note: "b" }]);

    const iterator = table.select({ note: table.f_note })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ note: "a" });

    // 在飞迭代还拿着连接：close 不等它（否则调用方不再 next 时会永久挂住）。
    await Promise.race([
      database.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("close hung on an in-flight cursor")), 1000),
      ),
    ]);
    await expect(iterator.next()).rejects.toMatchObject({
      kind: "closed",
      code: "ZEPHYR_RDB_CLOSED",
    });
    await database.close();
  });
});

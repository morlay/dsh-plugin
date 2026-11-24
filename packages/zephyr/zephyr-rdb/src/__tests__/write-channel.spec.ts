import { describe, expect, test } from "@morlay/zephyr/testing";
import { defineTable, ensureSchema, openDatabase } from "@morlay/zephyr-rdb";

const readings = defineTable({
  name: "t_readings",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_note: { type: "text", notNull: true },
  },
});

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

describe("写通道", () => {
  test("事务外的 insert … RETURNING 排在写队列之后，不落进未提交的事务", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [readings]);
      const table = database.table(readings);
      let entered!: () => void;
      const enteredTx = new Promise<void>((resolve) => (entered = resolve));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const tx = database.transaction(async (tx) => {
        await tx.table(readings).insert({ f_note: "in-tx" });
        entered();
        await gate;
        throw new Error("rollback");
      });
      await enteredTx;

      // 事务还没结束：事务外的 RETURNING 写必须排在它后面，不能成为它的一部分。
      const written = table.insert({ f_note: "outside" }, ["f_note"]);
      release();
      expect(await written).toMatchObject([{ f_note: "outside" }]);
      await expect(tx).rejects.toThrow("rollback");

      // 事务回滚只带走事务内的行；事务外的写还在。
      expect(await collect(table.select({ note: table.f_note }))).toEqual([{ note: "outside" }]);
    } finally {
      await database.close();
    }
  });

  test("事务内的 insert … RETURNING 与事务同生共死", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      await ensureSchema(database, [readings]);
      const table = database.table(readings);
      const seen = await database.transaction(async (tx) => {
        const [row] = await tx.table(readings).insert({ f_note: "in-tx" }, ["f_id", "f_note"]);
        // 事务内看得见自己的写（与写共用同一条连接）。
        const visible = await collect(tx.table(readings).select({ note: table.f_note }));
        expect(visible).toEqual([{ note: "in-tx" }]);
        return row;
      });
      expect(seen).toMatchObject({ f_note: "in-tx" });
      expect(await collect(table.select({ note: table.f_note }))).toEqual([{ note: "in-tx" }]);
    } finally {
      await database.close();
    }
  });
});

import { rm } from "node:fs/promises";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { defineTable, ensureSchema, openDatabase } from "@morlay/zephyr-rdb";

const rows = defineTable({
  name: "t_queue_rows",
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

describe("写队列按库身份共享", () => {
  test("同进程两个 Database 指向同一 sqlite 文件：写与事务不交错", async () => {
    const path = `/tmp/zephyr-rdb-queue-${String(Date.now())}.sqlite`;
    const first = await openDatabase({ dialect: "sqlite", path, busyTimeout: 2000 });
    const second = await openDatabase({ dialect: "sqlite", path, busyTimeout: 2000 });
    try {
      await ensureSchema(first, [rows]);
      const order: string[] = [];
      // A 的事务里先写一行、停 50ms、再写一行；B 的事务同时开工。
      // 共享一条队列时 B 排在 A 之后；各排各的队列时 B 会撞 SQLite 的写锁（同步等待 → 超时或 BUSY）。
      const firstTx = first.transaction(async (tx) => {
        await tx.table(rows).insert({ f_n: 1 });
        order.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 50));
        await tx.table(rows).insert({ f_n: 2 });
        order.push("first-end");
      });
      const secondTx = second.transaction(async (tx) => {
        await tx.table(rows).insert({ f_n: 10 });
        order.push("second");
      });
      await Promise.all([firstTx, secondTx]);
      expect(order).toEqual(["first-start", "first-end", "second"]);

      const values = await collect(
        first
          .table(rows)
          .select({ n: first.table(rows).f_n })
          .orderBy("f_n"),
      );
      expect(values.map((row) => row.n)).toEqual([1, 2, 10]);
    } finally {
      await first.close();
      await second.close();
      await rm(path, { force: true });
    }
  });
});

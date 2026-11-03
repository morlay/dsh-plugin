import { describe, expect, it } from "vitest";
import {
  and,
  between,
  column,
  defineCatalog,
  defineTable,
  eq,
  fragment,
  gt,
  inList,
  not,
  openDatabase,
  raw,
  sum,
  value,
} from "../index.ts";

const users = defineTable({
  name: "t_users",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_name: { type: "text", notNull: true },
    f_active: { type: "boolean", notNull: true, default: 1 },
  },
});

const orders = defineTable({
  name: "t_orders",
  columns: {
    f_id: { type: "serial", primaryKey: true },
    f_user: { type: "text", notNull: true },
    f_amount: { type: "integer", notNull: true },
  },
});

describe("关联 / 聚合 / 条件（两方言同一套构建）", () => {
  it("join + group by + having、distinct、between、not、raw", async () => {
    const database = await openDatabase({
      dialect: "sqlite",
      path: ":memory:",
      catalog: defineCatalog([users, orders]),
    });
    try {
      await database.run(
        fragment(
          'CREATE TABLE "t_users" ("f_id" INTEGER PRIMARY KEY AUTOINCREMENT, "f_name" TEXT NOT NULL, "f_active" INTEGER NOT NULL DEFAULT 1)',
        ),
      );
      await database.run(
        fragment(
          'CREATE TABLE "t_orders" ("f_id" INTEGER PRIMARY KEY AUTOINCREMENT, "f_user" TEXT NOT NULL, "f_amount" INTEGER NOT NULL)',
        ),
      );

      const userTable = database.table("t_users");
      const orderTable = database.table("t_orders");
      await userTable.insertMany([{ f_name: "ada" }, { f_name: "bob" }, { f_name: "carol" }]);
      await orderTable.insertMany([
        { f_user: "ada", f_amount: 3 },
        { f_user: "ada", f_amount: 4 },
        { f_user: "bob", f_amount: 1 },
      ]);

      // join + 聚合 + having + 排序
      const totals: { name: string; total: number | bigint }[] = [];
      for await (const row of userTable
        .select({ name: userTable.column("f_name"), total: sum("f_amount", "t_orders") })
        .join(orders, eq(column("f_user", "t_orders"), column("f_name", "t_users")))
        .groupBy("f_name")
        .having(gt(sum("f_amount", "t_orders"), value(2)))
        .orderBy("f_name")) {
        totals.push(row);
      }
      expect(totals).toEqual([{ name: "ada", total: 7 }]);

      // distinct 投影
      const actives: boolean[] = [];
      for await (const row of userTable
        .select({ active: userTable.column("f_active") })
        .distinct()) {
        actives.push(row.active);
      }
      expect(actives).toEqual([1]);

      // between / not / raw / inList
      const picked: number[] = [];
      for await (const row of orderTable
        .select({ id: orderTable.column("f_id") })
        .where(
          and(
            between(column("f_amount"), value(2), value(5)),
            not(inList(column("f_user"), ["bob"])),
            raw('"f_amount" <> ?', [99]),
          ),
        )) {
        picked.push(row.id);
      }
      expect(picked).toEqual([1, 2]);

      // 左连接 + 计数：没有订单的用户也出现
      const counts: { name: string; total: number | bigint }[] = [];
      for await (const row of userTable
        .select({ name: userTable.column("f_name"), total: sum("f_amount", "t_orders") })
        .join(orders, eq(column("f_user", "t_orders"), column("f_name", "t_users")), "left")
        .groupBy("f_name")) {
        counts.push(row);
      }
      expect(counts.some((row) => row.name === "bob" && Number(row.total) === 1)).toBe(true);
    } finally {
      await database.close();
    }
  });
});

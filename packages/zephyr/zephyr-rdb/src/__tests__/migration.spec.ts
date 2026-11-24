import { describe, expect, test } from "@morlay/zephyr/testing";
import {
  MigrationRegistry,
  defineTable,
  fragment,
  openDatabase,
  runMigrations,
  schemaMigrations,
} from "@morlay/zephyr-rdb";

const notes = defineTable({
  name: "t_notes",
  columns: {
    f_id: { type: "text", primaryKey: true, notNull: true },
    f_body: { type: "text" },
  },
});

describe("迁移注册表", () => {
  test("按 id 顺序执行一次、记账、幂等；失败的迁移不记账", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      const ran: string[] = [];
      const registry = new MigrationRegistry()
        .register({
          id: "002-second",
          up: async (tx) => {
            ran.push("002");
            await tx.table(notes).insert({ f_id: "b", f_body: "second" });
          },
        })
        .register({
          id: "001-first",
          up: async (tx) => {
            ran.push("001");
            await tx.table(notes).insert({ f_id: "a", f_body: "first" });
          },
        })
        .register({
          id: "003-broken",
          up: async () => {
            ran.push("003");
            throw new Error("boom");
          },
        });

      await expect(
        runMigrations(database, { catalog: [notes], migrations: registry }),
      ).rejects.toThrow("boom");
      // 001、002 已记账；003 失败回滚，不记账。
      expect(ran).toEqual(["001", "002", "003"]);

      const notesTable = database.table(notes);
      const bodyById = new Map<string, string | null>();
      for await (const row of notesTable.select({ id: notesTable.f_id, body: notesTable.f_body })) {
        bodyById.set(row.id, row.body);
      }
      expect(bodyById.get("a")).toBe("first");
      expect(bodyById.get("b")).toBe("second");

      // 已经记过账的不会再跑；003 仍然失败（账本里没有它）。
      ran.length = 0;
      await expect(
        runMigrations(database, { catalog: [notes], migrations: registry }),
      ).rejects.toThrow("boom");
      expect(ran).toEqual(["003"]);

      // 去掉失败的迁移后，只剩「无需执行」。
      const healthy = new MigrationRegistry().register({
        id: "001-first",
        up: async () => {},
      });
      expect(await runMigrations(database, { catalog: [notes], migrations: healthy })).toEqual({
        executed: [],
        drift: [],
      });
      const ledger = database.table(schemaMigrations);
      const ledgerRows: string[] = [];
      for await (const row of ledger.select({ id: ledger.f_id })) ledgerRows.push(row.id);
      expect(ledgerRows.sort()).toEqual(["001-first", "002-second"]);
    } finally {
      await database.close();
    }
  });
});

// 结构漂移要能被「打开库的人」看见：`runMigrations` 除了「执行了哪些迁移」，还交回 `ensureSchema` 的
// 漂移。判据是 orphan 这条——库里有、catalog 没有的表只报告，不进执行的语句（不删表）。
describe("迁移打开时的结构漂移", () => {
  test("结构对齐的漂移随结果一起返回：库里有、catalog 没有的表只报告不删", async () => {
    const database = await openDatabase({ dialect: "sqlite", path: ":memory:" });
    try {
      const migration = { id: "20261121-drift-probe", up: async () => {} };
      // 新库：对齐 + 执行迁移，没有漂移。
      expect(await runMigrations(database, { catalog: [notes], migrations: [migration] })).toEqual({
        executed: ["20261121-drift-probe"],
        drift: [],
      });

      // 库里有、catalog 没有的表（删表定义 / 不走迁移直接删账本之后就会这样）。
      await database.run(fragment('CREATE TABLE "t_legacy" ("f_id" TEXT NOT NULL)'));

      const result = await runMigrations(database, { catalog: [notes], migrations: [migration] });
      expect(result.executed).toEqual([]);
      expect(result.drift.map((entry) => [entry.table, entry.kind, entry.fix])).toEqual([
        ["t_legacy", "orphan", "manual"],
      ]);
      expect(result.drift[0]?.detail).toContain("not in catalog");
      // 只报告：表还在，没有任何 DDL 为它生成（迁移账本也不算 orphan）。
      expect(await database.objectNames()).toContain("t_legacy");
    } finally {
      await database.close();
    }
  });
});

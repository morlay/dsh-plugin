import { describe, expect, it } from "vitest";
import {
  MigrationRegistry,
  defineTable,
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
  it("按 id 顺序执行一次、记账、幂等；失败的迁移不记账", async () => {
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
      expect(await runMigrations(database, { catalog: [notes], migrations: healthy })).toEqual([]);
      const ledger = database.table(schemaMigrations);
      const ledgerRows: string[] = [];
      for await (const row of ledger.select({ id: ledger.f_id })) ledgerRows.push(row.id);
      expect(ledgerRows.sort()).toEqual(["001-first", "002-second"]);
    } finally {
      await database.close();
    }
  });
});

// 数据模型清理的判据：空表 t_schema_meta 从 catalog 移除（新库不含它）、库结构清单只有一份。
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRdbBackend } from "@morlay/better-session";
import { afterEach, describe, expect, it } from "vitest";
import { sqliteTableDefs } from "../entities/index.ts";
import { makeRoot, removeRoot } from "../../__tests__/support/host.ts";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await removeRoot(root);
});

async function freshDatabase(): Promise<DatabaseSync> {
  const root = await makeRoot();
  roots.push(root);
  const path = join(root, "sessions.sqlite");
  const backend = await openRdbBackend({
    type: "sqlite",
    path,
    journalMode: "wal",
    busyTimeout: 5000,
  });
  await backend.open();
  await backend.close();
  return new DatabaseSync(path);
}

function tableNamed(sqlite: DatabaseSync, name: string): unknown {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

describe("数据模型清理", () => {
  it("新建的库不含 t_schema_meta（空表从 catalog 移除，不写迁移）", async () => {
    const sqlite = await freshDatabase();
    try {
      expect(sqliteTableDefs.map((table) => table.name)).not.toContain("t_schema_meta");
      expect(tableNamed(sqlite, "t_schema_meta")).toBeUndefined();
      // 迁移的幂等靠账本，账本仍在。
      expect(tableNamed(sqlite, "t_schema_migrations")).toEqual({ name: "t_schema_migrations" });
    } finally {
      sqlite.close();
    }
  });
});

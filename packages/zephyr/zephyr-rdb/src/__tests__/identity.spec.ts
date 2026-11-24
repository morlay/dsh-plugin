import { rm } from "node:fs/promises";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { createPostgresTestDatabase } from "@morlay/zephyr-rdb/testing";
import { fingerprintHex, IDENTITY_MISMATCH_CODE, openDatabase } from "@morlay/zephyr-rdb";

describe("库身份（SQLite）", () => {
  test("首次打开认领库身份，重开校验通过；版本或身份不符即拒绝", async () => {
    const path = `/tmp/zephyr-rdb-identity-${String(Date.now())}.sqlite`;
    const identity = { name: "better-session", version: 3 };
    try {
      const first = await openDatabase({ dialect: "sqlite", path, identity });
      try {
        expect(await first.readIdentity()).toEqual({
          fingerprint: fingerprintHex("better-session"),
          version: 3,
        });
      } finally {
        await first.close();
      }

      const reopened = await openDatabase({ dialect: "sqlite", path, identity });
      try {
        expect((await reopened.readIdentity())?.version).toBe(3);
      } finally {
        await reopened.close();
      }

      await expect(
        openDatabase({ dialect: "sqlite", path, identity: { ...identity, version: 4 } }),
      ).rejects.toMatchObject({ kind: "identity", code: IDENTITY_MISMATCH_CODE });
      await expect(
        openDatabase({ dialect: "sqlite", path, identity: { name: "other", version: 3 } }),
      ).rejects.toMatchObject({ kind: "identity", code: IDENTITY_MISMATCH_CODE });
    } finally {
      await rm(path, { force: true });
    }
  });

  test("没有配置 identity 时不动库身份", async () => {
    const path = `/tmp/zephyr-rdb-identity-none-${String(Date.now())}.sqlite`;
    try {
      const database = await openDatabase({ dialect: "sqlite", path });
      try {
        expect(await database.readIdentity()).toBeUndefined();
        expect(await database.sqlitePragma("user_version")).toBe(0);
        expect(await database.sqlitePragma("application_id")).toBe(0);
      } finally {
        await database.close();
      }
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe.skipIf(!process.env.TEST_PG_URL)("库身份（PostgreSQL）", () => {
  test("schema 注释存身份：重开校验通过，版本不符拒绝", async () => {
    const testDatabase = await createPostgresTestDatabase();
    const config = {
      dialect: "postgres" as const,
      connectionString: testDatabase.connectionString,
      identity: { name: "better-session", version: 1 },
    };
    try {
      const first = await openDatabase(config);
      try {
        expect(await first.readIdentity()).toEqual({
          fingerprint: fingerprintHex("better-session"),
          version: 1,
        });
      } finally {
        await first.close();
      }
      const reopened = await openDatabase(config);
      await reopened.close();
      await expect(
        openDatabase({ ...config, identity: { name: "better-session", version: 2 } }),
      ).rejects.toMatchObject({ kind: "identity", code: IDENTITY_MISMATCH_CODE });
    } finally {
      await testDatabase.drop();
    }
  });
});

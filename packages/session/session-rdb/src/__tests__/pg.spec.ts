import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { Context } from "@deepseek-ai/cordis";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { EmptySettings } from "@morlay/session-rdb/testing";
import SessionPersistenceRdb from "@morlay/session-rdb";
import { runPersistenceContract } from "@morlay/session-rdb/testing";
import { runCoordinatorContract, type CoordinatorFixture } from "@morlay/session-rdb/testing";

const ADMIN_URL =
  process.env.TEST_PG_URL ?? "postgres://postgres:postgres@localhost:25433/postgres";

async function createTestDatabase(): Promise<{
  connectionString: string;
  drop: () => Promise<void>;
}> {
  const name = `dsh_test_${randomUUID().replace(/-/g, "")}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return {
    connectionString: url.toString(),
    drop: async () => {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

describe.skipIf(!process.env.TEST_PG_URL)("PostgreSQL backend", () => {
  runPersistenceContract("postgres", async () => {
    const { connectionString, drop } = await createTestDatabase();
    const ctx = new Context();
    await ctx.plugin(EmptySettings);
    await ctx.plugin(SessionStore);
    const fiber = await ctx.plugin(SessionPersistenceRdb, {
      type: "postgres",
      connectionString,
    });
    return {
      persistence: ctx.sessionPersistence,
      dispose: async () => {
        await fiber.dispose();
        await drop();
      },
    };
  });

  runCoordinatorContract("postgres", async (): Promise<CoordinatorFixture> => {
    const { connectionString, drop } = await createTestDatabase();
    return {
      mount: async (ctx: Context) => {
        if (ctx.reflect.get("settings") === undefined) {
          await ctx.plugin(EmptySettings);
        }
        return await ctx.plugin(SessionPersistenceRdb, { type: "postgres", connectionString });
      },

      cleanup: async () => {
        await drop();
      },
    };
  });

  // 写事务按介质串行：PG 侧原先并发 `writeAtomically` 会互相覆盖实例级的事务槽位
  // （后开始的事务抢走槽位后，先开始的语句落到别人的事务或退化成 autocommit）。
  it("并发写事务不交错（失败的那个不留痕迹）", async () => {
    const { connectionString, drop } = await createTestDatabase();
    const ctx = new Context();
    await ctx.plugin(EmptySettings);
    await ctx.plugin(SessionStore);
    const fiber = await ctx.plugin(SessionPersistenceRdb, {
      type: "postgres",
      connectionString,
    });
    try {
      const persistence = ctx.sessionPersistence as InstanceType<typeof SessionPersistenceRdb>;
      const storage = persistence.internals().backend.storage;
      const record = (name: string, title: string) => ({
        path: `/${name}`,
        title,
        sessionIds: [],
        createdAt: "1",
        updatedAt: "1",
      });

      // w-a 的 title 违反 NOT NULL：它的事务必须整体回滚且不留痕迹，w-b 独立提交。
      const failing = storage.putWorkspace("w-a", record("a", null as never));
      const committing = storage.putWorkspace("w-b", record("b", "b"));
      const settled = await Promise.allSettled([failing, committing]);

      expect(settled[0]?.status).toBe("rejected");
      expect(settled[1]?.status).toBe("fulfilled");

      const ids = (await storage.listWorkspaces()).map((entry) => entry.id);
      expect(ids).toContain("w-b");
      expect(ids).not.toContain("w-a");
    } finally {
      await fiber.dispose();
      await drop();
    }
  });
});

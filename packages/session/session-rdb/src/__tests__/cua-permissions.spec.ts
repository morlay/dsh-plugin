// 官方 `cua` bundle 的授权存储（`dsh-cua` 的 `permission-store.ts`）是这条域的真实行：每次决策都在
// profile 文件锁内 `defineDomain` 一个 `cua_permissions_<profile 真实目录 sha256>` 域、整值读写 global。
// 这里跑真装配（上游 store + 官方域层 + rdb 后端），判据是「重启后读回」与「profile 之间互不可见」。
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Context } from "@deepseek-ai/cordis";
import { SessionStore } from "@deepseek-ai/dsh-session";
import Storage from "@deepseek-ai/dsh-storage";
import * as StorageDomain from "@deepseek-ai/dsh-storage-domain";
import { CuaPermissionStore } from "@deepseek-ai/dsh-cua/src/permission-store.ts";
import type {
  CuaApplicationGrant,
  CuaApplicationId,
} from "@deepseek-ai/dsh-cua/src/application-types.ts";
import SessionPersistenceSqlite from "../index.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const signal = new AbortController().signal;
const id = "a".repeat(64) as CuaApplicationId;
const grant: CuaApplicationGrant = { id, name: "Fixture", executablePath: "/fixture/app" };

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function mount(
  root: string,
  profile: string,
): Promise<{ store: CuaPermissionStore; dispose: () => Promise<void> }> {
  await mkdir(profile, { recursive: true });
  const ctx = new Context();
  ctx.provide("profileContext", { dir: profile });
  await ctx.plugin(Storage);
  await ctx.plugin(StorageDomain, { backend: "rdb" });
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionPersistenceSqlite, {
    type: "sqlite",
    path: join(root, "sessions.sqlite"),
  });
  const store = new CuaPermissionStore(ctx, [], 30_000);
  return {
    store,
    dispose: async () => {
      await store.drain();
      await ctx.fiber.dispose();
    },
  };
}

describe("cua permissions over the rdb storage backend", () => {
  it("retains application and conversation decisions across a restart", async () => {
    const root = await tempDir("cua-permissions-store-");
    const profile = join(root, "profile");

    const first = await mount(root, profile);
    try {
      // 首次访问：域里没有 global，域层用 initial（`migrated: false`），store 随即落一份导入结果。
      expect(await first.store.withState(signal, (transaction) => transaction.state)).toEqual({
        migrated: true,
        applications: {},
      });
      await first.store.withState(signal, async (transaction) => {
        await transaction.save({
          migrated: true,
          applications: {
            [id]: {
              revoked: 0,
              always: grant,
              sessions: {
                conversation: { identity: grant, decision: "allow", revision: 1 },
              },
            },
          },
        });
      });
    } finally {
      await first.dispose();
    }

    // 换一个进程形（新 ctx、同一份库、同一份 profile）：决定从库里读回来。
    const resumed = await mount(root, profile);
    try {
      const stored = await resumed.store.withState(signal, (transaction) => transaction.state);
      expect(stored.applications[id]?.always).toEqual(grant);
      expect(stored.applications[id]?.sessions.conversation?.decision).toBe("allow");

      const db = new DatabaseSync(join(root, "sessions.sqlite"));
      try {
        const rows = db
          .prepare("SELECT f_domain FROM t_storage_records WHERE f_table = ''")
          .all() as Array<{
          f_domain: string;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.f_domain).toMatch(/^cua_permissions_[a-f0-9]{64}$/);
      } finally {
        db.close();
      }
    } finally {
      await resumed.dispose();
    }
  });

  it("isolates profiles that share one session database", async () => {
    const root = await tempDir("cua-permissions-isolation-");

    const mine = await mount(root, join(root, "profile-a"));
    try {
      await mine.store.withState(signal, async (transaction) => {
        await transaction.save({
          migrated: true,
          applications: {
            [id]: { revoked: 0, always: grant, sessions: {} },
          },
        });
      });
    } finally {
      await mine.dispose();
    }

    // 同一份库上的另一份 profile：域名带自己目录的摘要，读到的是自己的空授权。
    const other = await mount(root, join(root, "profile-b"));
    try {
      expect(
        await other.store.withState(signal, (transaction) => transaction.state.applications),
      ).toEqual({});
    } finally {
      await other.dispose();
    }

    const db = new DatabaseSync(join(root, "sessions.sqlite"));
    try {
      const rows = db
        .prepare("SELECT f_domain FROM t_storage_records WHERE f_table = '' ORDER BY f_domain")
        .all() as Array<{ f_domain: string }>;
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.f_domain)).size).toBe(2);
    } finally {
      db.close();
    }
  });
});

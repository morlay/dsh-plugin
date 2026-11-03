import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Context } from "@deepseek-ai/cordis";
import { createAtScheduleRecord, ScheduleId, scheduleDomain } from "@deepseek-ai/dsh-schedule";
import { SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import Storage from "@deepseek-ai/dsh-storage";
import type { StorageBackend } from "@deepseek-ai/dsh-storage";
import * as StorageDomain from "@deepseek-ai/dsh-storage-domain";
import Workspace from "@deepseek-ai/dsh-workspace";
import SessionPersistenceSqlite from "../index.ts";
import { meta } from "../testing.ts";
import { importStorages } from "../import-storages.ts";
import { openRdbBackend } from "../db/open.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the service");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("workspace domain on the rdb storage backend", () => {
  it("persists records and registry state without a storages file tree", async () => {
    const root = await tempDir("storage-takeover-");
    const dbPath = join(root, "sessions.sqlite");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });

    const ctx = new Context();
    await ctx.plugin(Storage);
    await ctx.plugin(StorageDomain, { backend: "rdb" });
    await ctx.plugin(SessionStore);
    const fiber = await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: dbPath });
    await ctx.plugin(Workspace);
    try {
      const registry = await waitFor(
        () =>
          ctx.get("workspaceRegistry") as
            | {
                create(path: string): Promise<{ path: string; title: string }>;
                archiveSession(sessionId: SessionId): Promise<void>;
              }
            | undefined,
      );
      const workspace = await registry.create(project);

      const canonical = await realpath(project);
      expect(workspace.path).toBe(canonical);

      const db = new DatabaseSync(dbPath);
      try {
        const records = db
          .prepare(
            "SELECT f_key, f_value FROM t_storage_records WHERE f_domain = 'workspace' AND f_table = 'workspaces'",
          )
          .all() as Array<{ f_key: string; f_value: string }>;
        expect(records).toHaveLength(1);
        const record = JSON.parse(records[0]!.f_value) as { path: string; sessionIds: string[] };
        expect(record.path).toBe(canonical);
        expect(record.sessionIds).toEqual([]);
        const globalRow = db
          .prepare(
            "SELECT f_value FROM t_storage_records WHERE f_domain = 'workspace' AND f_table = ''",
          )
          .get() as { f_value: string };
        expect(JSON.parse(globalRow.f_value)).toMatchObject({
          initialized: true,
          workspaceIds: [records[0]!.f_key],
        });

        const sessionId = SessionId("archive-me");
        ctx.sessions.create(sessionId, { meta: meta("archive-me", canonical) });
        await ctx.sessions.flush(ctx.sessions.get(sessionId)!);
        await registry.archiveSession(sessionId);
        const archived = db
          .prepare("SELECT f_session_id FROM t_sessions WHERE f_archived_at IS NOT NULL")
          .all() as Array<{ f_session_id: string }>;
        expect(archived.map((row) => row.f_session_id)).toEqual(["archive-me"]);

        const unit = db
          .prepare("SELECT f_version FROM t_storage_units WHERE f_name = 'workspace'")
          .get() as { f_version: number };
        expect(unit.f_version).toBe(2);
      } finally {
        db.close();
      }

      await expect(stat(join(root, "storages"))).rejects.toThrow();
    } finally {
      await fiber.dispose();
    }
  });
});

// 官方 `dsh-schedule` 的域（`tasks` 一张表、无 global）：web-app 在每份 profile 里挂那一行，而
// `storage-domain` 的 backend 路由指向 `rdb` —— 这个域也得由 rdb 服务（否则那一行开域即报错）。
describe("schedule domain on the rdb storage backend", () => {
  async function mount(dbPath: string): Promise<Context> {
    const ctx = new Context();
    await ctx.plugin(Storage);
    await ctx.plugin(StorageDomain, { backend: "rdb" });
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: dbPath });
    return ctx;
  }

  it("stores host reminders in the session database and reads them back after a reopen", async () => {
    const root = await tempDir("schedule-domain-");
    const dbPath = join(root, "sessions.sqlite");
    const id = ScheduleId("sched-1");
    const task = {
      sessionId: SessionId("session-sched"),
      record: createAtScheduleRecord(
        id,
        "提醒我喝水",
        "2030-01-01T00:00:00.000Z",
        Date.now(),
        "喝水",
      ),
      status: "active" as const,
    };

    const first = await mount(dbPath);
    try {
      const domain = await first.storageDomain.open(scheduleDomain);
      await domain.table("tasks").put(id, task);

      const db = new DatabaseSync(dbPath);
      try {
        const rows = db
          .prepare(
            "SELECT f_key, f_value FROM t_storage_records WHERE f_domain = 'schedule' AND f_table = 'tasks'",
          )
          .all() as Array<{ f_key: string; f_value: string }>;
        expect(rows.map((row) => row.f_key)).toEqual(["sched-1"]);
        expect(JSON.parse(rows[0]!.f_value)).toMatchObject({
          sessionId: "session-sched",
          status: "active",
        });
      } finally {
        db.close();
      }
    } finally {
      await first.fiber.dispose();
    }

    // 重开：任务从库里读回来（同一份介质，没有第二个 storages 文件树）。
    const second = await mount(dbPath);
    try {
      const reopened = await second.storageDomain.open(scheduleDomain);
      expect(reopened.table("tasks").get(id)).toEqual(task);

      await reopened.table("tasks").delete(id);
      expect([...reopened.table("tasks").entries()]).toEqual([]);
    } finally {
      await second.fiber.dispose();
    }
  });
});

// 上游「无表、只有 global」的域（目前是 cua bundle 的授权域：`cua_permissions_<profile 摘要>`，
// 域名由 profile 真实目录派生）不一个域一张表：域名就是行键，统一落 `t_storage_records`。
describe("global-only domains on the rdb storage backend", () => {
  const name = `cua_permissions_${"a".repeat(64)}`;
  const descriptor = { name, version: 1, tables: [], hasGlobal: true } as const;
  const state = {
    migrated: true,
    applications: {
      ["b".repeat(64)]: {
        revoked: 0,
        always: { id: "b".repeat(64), name: "Fixture" },
        sessions: {
          conversation: {
            identity: { id: "b".repeat(64), name: "Fixture" },
            decision: "allow",
            revision: 1,
          },
        },
      },
    },
  };

  async function mount(dbPath: string): Promise<Context> {
    const ctx = new Context();
    await ctx.plugin(Storage);
    await ctx.plugin(StorageDomain, { backend: "rdb" });
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: dbPath });
    return ctx;
  }

  it("按域名分行：一份域一行整值文档，重开后读回", async () => {
    const root = await tempDir("storage-globals-");
    const dbPath = join(root, "sessions.sqlite");

    const first = await mount(dbPath);
    try {
      const kv = first.storage.backend.get("rdb").kv!;
      const unit = await kv.open({ ...descriptor });
      // 从未写过：global 是 `null`（域层据此拿 spec 的 initial），也不声明任何表。
      expect(await unit.loadAll()).toEqual({ tables: {}, global: null });

      await unit.setGlobal(state);
      // 同形的另一个域：同一张表、不同行，互不可见。
      const other = await kv.open({ name: "goal", version: 1, tables: [], hasGlobal: true });
      await other.setGlobal({ note: "unrelated" });
      await Promise.all([unit.close(), other.close()]);

      const db = new DatabaseSync(dbPath);
      try {
        const rows = db
          .prepare(
            "SELECT f_domain, f_value FROM t_storage_records WHERE f_table = '' ORDER BY f_domain",
          )
          .all() as Array<{ f_domain: string; f_value: string }>;
        expect(rows.map((row) => row.f_domain)).toEqual([name, "goal"]);
        expect(JSON.parse(rows[0]!.f_value)).toEqual(state);

        const versions = db
          .prepare("SELECT f_name, f_version FROM t_storage_units ORDER BY f_name")
          .all() as Array<{ f_name: string; f_version: number }>;
        expect(versions).toEqual([
          { f_name: name, f_version: 1 },
          { f_name: "goal", f_version: 1 },
        ]);
      } finally {
        db.close();
      }
    } finally {
      await first.fiber.dispose();
    }

    const second = await mount(dbPath);
    try {
      const reopened = await second.storage.backend.get("rdb").kv!.open({ ...descriptor });
      expect((await reopened.loadAll()).global).toEqual(state);
      await reopened.close();
    } finally {
      await second.fiber.dispose();
    }
  });

  it("写未声明的表、给没有 global 的域写 global 仍 fail loud", async () => {
    const root = await tempDir("storage-globals-shape-");
    const dbPath = join(root, "sessions.sqlite");
    const ctx = await mount(dbPath);
    try {
      const unit = await ctx.storage.backend
        .get("rdb")
        .kv!.open({ name: "goal", version: 1, tables: ["goals"], hasGlobal: false });
      await expect(unit.putRecord("tasks", "x", {})).rejects.toThrow(/does not declare table/);
      await expect(unit.setGlobal({})).rejects.toThrow(/no global slot/);
      await unit.close();
    } finally {
      await ctx.fiber.dispose();
    }
  });
});

// 上一版把每个域拆成自己的语义表；升级后启动时一次性搬进通用表（旧表保留可回退）。
describe("旧语义表到通用域存储的一次性搬运", () => {
  it("搬 workspace（含归属顺序 / 归档 / 钉住）、schedule 与 cua 授权域", async () => {
    const root = await tempDir("legacy-domain-migration-");
    const dbPath = join(root, "sessions.sqlite");
    // 先开一次建出全部表并写搬运标记；关掉后删标记，模拟「上一版的库」。
    const first = await openRdbBackend({ type: "sqlite", path: dbPath, journalMode: "wal", busyTimeout: 5000 });
    await first.open();
    await first.close();

    const seed = new DatabaseSync(dbPath);
    try {
      seed
        .prepare("DELETE FROM t_schema_meta WHERE f_key = 'legacy_domain_storage_migrated'")
        .run();
      // 模拟上一版的库：旧语义表由旧版迁移建出来，新版的表定义里已经没有它们。
      for (const statement of [
        "CREATE TABLE IF NOT EXISTS t_workspaces (f_workspace_id text PRIMARY KEY, f_path text NOT NULL, f_title text NOT NULL, f_created_at text NOT NULL, f_updated_at text NOT NULL, f_position integer NOT NULL DEFAULT -1)",
        "CREATE TABLE IF NOT EXISTS t_workspace_sessions (f_workspace_id text NOT NULL, f_session_id text NOT NULL, f_position integer NOT NULL)",
        "CREATE TABLE IF NOT EXISTS t_workspace_state (f_singleton integer PRIMARY KEY, f_initialized integer NOT NULL, f_pending_operation text, f_pending_workspace_id text)",
        "CREATE TABLE IF NOT EXISTS t_schedule_tasks (f_id text PRIMARY KEY, f_session_id text NOT NULL, f_status text NOT NULL, f_record text NOT NULL, f_last_delivery text, f_delivery_history text)",
        "CREATE TABLE IF NOT EXISTS t_storage_globals (f_domain text PRIMARY KEY, f_value text NOT NULL)",
      ]) {
        seed.exec(statement);
      }
      seed.prepare("DELETE FROM t_storage_records").run();
      seed
        .prepare(
          "INSERT INTO t_workspaces (f_workspace_id, f_path, f_title, f_created_at, f_updated_at, f_position) VALUES ('w1', '/p', 'P', '1', '2', 0)",
        )
        .run();
      seed
        .prepare(
          "INSERT INTO t_workspace_sessions (f_workspace_id, f_session_id, f_position) VALUES ('w1', 's2', 1), ('w1', 's1', 0)",
        )
        .run();
      seed
        .prepare("INSERT INTO t_workspace_state (f_singleton, f_initialized) VALUES (1, 1)")
        .run();
      seed
        .prepare(
          "INSERT INTO t_sessions (f_session_id, f_version, f_created_at, f_incarnation, f_revision, f_archived_at, f_pinned_seq) VALUES ('s1', 3, 1, 'x', 0, 10, 0)",
        )
        .run();
      seed
        .prepare(
          "INSERT INTO t_schedule_tasks (f_id, f_session_id, f_status, f_record) VALUES ('t1', 's1', 'active', '{\"prompt\":\"喝水\"}')",
        )
        .run();
      seed
        .prepare(
          "INSERT INTO t_storage_globals (f_domain, f_value) VALUES ('cua_permissions_abc', '{\"migrated\":true}')",
        )
        .run();
    } finally {
      seed.close();
    }

    const reopened = await openRdbBackend({ type: "sqlite", path: dbPath, journalMode: "wal", busyTimeout: 5000 });
    await reopened.open();
    try {
      const records = await reopened.storage.listDomainRecords("workspace");
      expect(records).toEqual([
        {
          table: "workspaces",
          key: "w1",
          value: {
            path: "/p",
            title: "P",
            sessionIds: ["s1", "s2"],
            createdAt: "1",
            updatedAt: "2",
          },
        },
      ]);
      expect(await reopened.storage.readDomainGlobal("workspace")).toMatchObject({
        initialized: true,
        workspaceIds: ["w1"],
        archivedSessionIds: ["s1"],
        pinnedSessionIds: ["s1"],
      });
      expect(await reopened.storage.listDomainRecords("schedule")).toEqual([
        {
          table: "tasks",
          key: "t1",
          value: { sessionId: "s1", record: { prompt: "喝水" }, status: "active" },
        },
      ]);
      expect(await reopened.storage.readDomainGlobal("cua_permissions_abc")).toEqual({
        migrated: true,
      });
      // 搬过一次就不再搬：清空通用表后重开不会把旧行搬回来。
      const cleared = new DatabaseSync(dbPath);
      try {
        cleared.prepare("DELETE FROM t_storage_records").run();
      } finally {
        cleared.close();
      }
    } finally {
      await reopened.close();
    }
    const again = await openRdbBackend({ type: "sqlite", path: dbPath, journalMode: "wal", busyTimeout: 5000 });
    await again.open();
    try {
      expect(await again.storage.listDomainRecords("workspace")).toEqual([]);
      expect(await again.storage.listDomainRecords("schedule")).toEqual([]);
    } finally {
      await again.close();
    }
  });
});

describe("rdb KV backend contract", () => {
  const descriptor = {
    name: "workspace",
    version: 2,
    tables: ["workspaces"],
    hasGlobal: true,
  } as const;

  async function harness(): Promise<{
    backend: StorageBackend;
    dbPath: string;
    dispose: () => Promise<void>;
  }> {
    const root = await tempDir("kv-backend-");
    const dbPath = join(root, "sessions.sqlite");
    const ctx = new Context();
    await ctx.plugin(Storage);
    await ctx.plugin(StorageDomain, { backend: "rdb" });
    await ctx.plugin(SessionStore);
    const fiber = await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path: dbPath });
    const backend = await waitFor(
      () => ctx.storage.backend.get("rdb") as StorageBackend | undefined,
    );
    return { backend, dbPath, dispose: () => fiber.dispose() };
  }

  it("rejects a concurrent double-open before the medium read", async () => {
    const { backend, dispose } = await harness();
    try {
      const first = backend.kv!.open({ ...descriptor });
      const second = backend.kv!.open({ ...descriptor });
      await expect(second).rejects.toThrow(/already open/);
      const unit = await first;
      await unit.close();

      const reopened = await backend.kv!.open({ ...descriptor });
      await reopened.close();
    } finally {
      await dispose();
    }
  });

  it("drains accepted writes before closing and refuses later writes", async () => {
    const { backend, dbPath, dispose } = await harness();
    try {
      const unit = await backend.kv!.open({ ...descriptor });
      const record = {
        path: "/tmp/kv-drain",
        title: "kv-drain",
        sessionIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const writing = unit.putRecord("workspaces", "w-drain", record);
      await backend.close();
      await writing;

      const db = new DatabaseSync(dbPath);
      try {
        const rows = db
          .prepare(
            "SELECT f_key FROM t_storage_records WHERE f_domain = 'workspace' AND f_table = 'workspaces'",
          )
          .all() as Array<{ f_key: string }>;
        expect(rows.map((row) => row.f_key)).toEqual(["w-drain"]);
      } finally {
        db.close();
      }

      await expect(unit.putRecord("workspaces", "w-late", record)).rejects.toThrow(/closed/);
      await expect(backend.kv!.open({ ...descriptor })).rejects.toThrow(/closed/);
    } finally {
      await dispose();
    }
  });

  it("行存储对 per-record 布局同构：照样一条记录一行", async () => {
    const { backend, dispose } = await harness();
    try {
      const unit = await backend.kv!.open({ ...descriptor, layout: "per-record" });
      await unit.putRecord("workspaces", "w-per-record", {
        path: "/tmp/kv-per-record",
        title: "kv-per-record",
        sessionIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect((await unit.loadAll()).tables["workspaces"]?.["w-per-record"]).toMatchObject({
        title: "kv-per-record",
      });
      await unit.close();
    } finally {
      await dispose();
    }
  });

  it("任何域都按 (域, 表, 键) 落行，不再按名字白名单拒收", async () => {
    const { backend, dispose } = await harness();
    try {
      const unit = await backend.kv!.open({
        name: "goal",
        version: 1,
        tables: ["goals"],
        hasGlobal: true,
      });
      await unit.putRecord("goals", "g1", { title: "跑一次全量" });
      await unit.setGlobal({ active: "g1" });
      const snapshot = await unit.loadAll();
      expect(snapshot.tables["goals"]).toEqual({ g1: { title: "跑一次全量" } });
      expect(snapshot.global).toEqual({ active: "g1" });
      await unit.close();
    } finally {
      await dispose();
    }
  });
});

describe("legacy storages import", () => {
  it("writes workspace and projcache documents into the rdb tables", async () => {
    const dshHome = await tempDir("storages-import-");
    await mkdir(join(dshHome, "storages", "session_projcache", "sessions"), { recursive: true });
    await writeFile(
      join(dshHome, "storages", "workspace.json"),
      JSON.stringify({
        unit: { name: "workspace", version: 2 },
        global: { initialized: true, workspaceIds: ["w1"], archivedSessionIds: ["s1"] },
        tables: {
          workspaces: {
            w1: {
              path: "/tmp/w1",
              title: "w1",
              sessionIds: ["s1"],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dshHome, "storages", "session_projcache", "sessions", "sess-1.json"),
      JSON.stringify({
        version: 7,
        record: {
          identity: {
            formatVersion: 3,
            createdAt: 1,
            cwd: "/tmp/w1",
            isSeeded: false,
            inheritedEventCount: 0,
          },
          rows: { title: { ver: 1, seq: 2, val: "hello" } },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(dshHome, "storages", "session_projcache", "sessions", "sess-2.json"),
      JSON.stringify({ version: 1, record: { identity: { createdAt: 1 }, rows: {} } }),
      "utf8",
    );

    const backend = await openRdbBackend({ type: "sqlite",
      path: join(dshHome, "sessions.sqlite"),
      journalMode: "wal",
      busyTimeout: 5000,
    });
    await backend.open();
    try {
      const seed = new DatabaseSync(join(dshHome, "sessions.sqlite"));
      try {
        for (const sessionId of ["s1", "sess-1"]) {
          seed
            .prepare(
              "INSERT INTO t_sessions (f_session_id, f_version, f_created_at, f_incarnation, f_revision) VALUES (?, 3, 1, 'seed', 0)",
            )
            .run(sessionId);
        }
      } finally {
        seed.close();
      }
      const result = await importStorages(backend.storage, { dshHome });
      expect(result).toEqual({ workspaces: 1, workspaceState: true, projcache: 1 });

      const records = await backend.storage.listDomainRecords("workspace");
      const listed = records
        .filter((entry) => entry.table === "workspaces")
        .map((entry) => ({
          id: entry.key,
          record: entry.value as { title: string; sessionIds: string[] },
        }));
      expect(listed.map((entry) => entry.id)).toEqual(["w1"]);
      expect(listed[0]!.record.title).toBe("w1");

      expect(listed[0]!.record.sessionIds).toEqual(["s1"]);
      expect(await backend.storage.readDomainGlobal("workspace")).toMatchObject({
        initialized: true,
        workspaceIds: ["w1"],
        archivedSessionIds: ["s1"],
      });

      const entries = await backend.storage.loadProjcache();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.sessionId).toBe("sess-1");
      expect(entries[0]!.rows["title"]).toEqual({ ver: 1, seq: 2, val: "hello" });
      expect(await backend.storage.readUnitVersion("session_projcache")).toBe(7);
      expect(await backend.storage.readUnitVersion("workspace")).toBe(2);
    } finally {
      await backend.close();
    }
  });
});

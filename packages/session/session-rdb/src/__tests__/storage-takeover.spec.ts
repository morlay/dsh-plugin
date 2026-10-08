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
import SessionPersistenceSqlite from "@morlay/session-rdb";
import { meta } from "@morlay/session-rdb/testing";
import { importStorages } from "../import-storages.ts";
import { SqliteBackend } from "../sqlite.ts";

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
        const rows = db
          .prepare("SELECT f_workspace_id, f_path, f_title, f_position FROM t_workspaces")
          .all() as Array<{
          f_workspace_id: string;
          f_path: string;
          f_title: string;
          f_position: number;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.f_path).toBe(canonical);

        expect(rows[0]!.f_position).toBe(0);
        expect(db.prepare("SELECT f_session_id FROM t_workspace_sessions").all()).toEqual([]);

        const sessionId = SessionId("archive-me");
        ctx.sessions.create(sessionId, { meta: meta("archive-me", canonical) });
        await ctx.sessions.flush(ctx.sessions.get(sessionId)!);
        await registry.archiveSession(sessionId);
        const archived = db
          .prepare("SELECT f_session_id FROM t_sessions WHERE f_archived_at IS NOT NULL")
          .all() as Array<{ f_session_id: string }>;
        expect(archived.map((row) => row.f_session_id)).toEqual(["archive-me"]);

        const state = db
          .prepare("SELECT f_initialized FROM t_workspace_state WHERE f_singleton = 1")
          .get() as { f_initialized: number };
        expect(state.f_initialized).toBe(1);

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
          .prepare("SELECT f_id, f_session_id, f_status FROM t_schedule_tasks")
          .all() as Array<{ f_id: string; f_session_id: string; f_status: string }>;
        expect(rows).toEqual([
          { f_id: "sched-1", f_session_id: "session-sched", f_status: "active" },
        ]);
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
        const rows = db.prepare("SELECT f_workspace_id FROM t_workspaces").all() as Array<{
          f_workspace_id: string;
        }>;
        expect(rows.map((row) => row.f_workspace_id)).toEqual(["w-drain"]);
      } finally {
        db.close();
      }

      await expect(unit.putRecord("workspaces", "w-late", record)).rejects.toThrow(/closed/);
      await expect(backend.kv!.open({ ...descriptor })).rejects.toThrow(/closed/);
    } finally {
      await dispose();
    }
  });

  it("rejects a per-record layout instead of reading it as single", async () => {
    const { backend, dispose } = await harness();
    try {
      await expect(backend.kv!.open({ ...descriptor, layout: "per-record" })).rejects.toThrow(
        /single/,
      );
    } finally {
      await dispose();
    }
  });

  it("rejects a domain it does not serve instead of guessing a table", async () => {
    const { backend, dispose } = await harness();
    try {
      await expect(
        backend.kv!.open({ name: "goal", version: 1, tables: ["goals"], hasGlobal: false }),
      ).rejects.toThrow(/serves only/);
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

    const backend = new SqliteBackend({
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

      const listed = await backend.storage.listWorkspaces();
      expect(listed.map((entry) => entry.id)).toEqual(["w1"]);
      expect(listed[0]!.record.title).toBe("w1");

      expect(listed[0]!.record.sessionIds).toEqual(["s1"]);
      expect(await backend.storage.readWorkspaceState()).toMatchObject({
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

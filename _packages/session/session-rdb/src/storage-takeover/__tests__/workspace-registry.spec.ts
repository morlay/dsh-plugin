import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Context } from "@deepseek-ai/cordis";
import { bootstrapApplication , resolveServiceName } from "@morlay/zephyr";
import { SessionId, SessionStore } from "@deepseek-ai/dsh-session";
import { StorageDefault, StorageDomainDefault as StorageDomainRow } from "@morlay/dsh-base/storage";
import { Workspace as WorkspaceRow } from "@morlay/dsh-base/workspace";
import { SessionPersistenceRdb } from "../../index.ts";
import { harness as rdbHarness, meta } from "../../testing.ts";

const dirs: string[] = [];
const extraApps: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  for (const app of extraApps.splice(0)) await app.dispose();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function waitFor<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the service");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface WorkspaceFace {
  create(path: string): Promise<WorkspaceEntity>;
  list(): Promise<WorkspaceEntity[]>;
  archivedSessionIds: readonly SessionId[];
  archiveSession(sessionId: SessionId): Promise<void>;
}

interface WorkspaceEntity {
  path: string;
  sessionIds: readonly SessionId[];
  attachSession(sessionId: SessionId): Promise<void>;
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>;
  detachSession(sessionId: SessionId): Promise<void>;
}

async function harness(
  dbPath: string,
  project: string,
): Promise<{
  ctx: Context;
  registry: WorkspaceFace;
  canonical: string;
  dispose: () => Promise<void>;
}> {
  const canonical = await realpath(project);
  const rdb = await rdbHarness({
    config: { type: "sqlite", path: dbPath },
    providers: [StorageDefault],
  });
  const ctx = rdb.ctx;
  await waitFor(() => ctx.get("storage"));
  // domain / workspace 走我们的适配类（与运行期同一套装配）。
  extraApps.push(await bootstrapApplication({
    ctx,
    providers: [StorageDomainRow.withConfig({ backend: "rdb" }), WorkspaceRow],
    timeoutMs: 15000,
  }));
  const registry = await waitFor(() => resolveServiceName(ctx, "workspaceRegistry") as WorkspaceFace | undefined);
  return { ctx, registry, canonical, dispose: () => rdb.app.dispose() };
}

async function seedSession(ctx: Context, id: string, cwd: string): Promise<SessionId> {
  const sessionId = SessionId(id);
  const live = ctx.sessions.create(sessionId, { meta: meta(id, cwd) });
  await ctx.sessions.flush(live);
  return sessionId;
}

function membershipRows(dbPath: string): Array<{ f_session_id: string; f_position: number }> {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare("SELECT f_session_id, f_position FROM t_workspace_sessions ORDER BY f_position")
      .all() as Array<{ f_session_id: string; f_position: number }>;
  } finally {
    db.close();
  }
}

describe("official workspace registry over the rdb storage backend", () => {
  it("attaches, reorders, and detaches membership as durable rows", { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-registry-"));
    dirs.push(root);
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const dbPath = join(root, "sessions.sqlite");
    const h = await harness(dbPath, project);
    try {
      const workspace = await h.registry.create(project);
      for (const id of ["s1", "s2", "s3"]) {
        await workspace.attachSession(await seedSession(h.ctx, id, h.canonical));
      }

      expect(workspace.sessionIds.map(String)).toEqual(["s3", "s2", "s1"]);
      expect(membershipRows(dbPath).map((row) => row.f_session_id)).toEqual(["s3", "s2", "s1"]);

      await workspace.insertSessionBefore(SessionId("s1"), SessionId("s3"));
      expect(workspace.sessionIds.map(String)).toEqual(["s1", "s3", "s2"]);
      expect(membershipRows(dbPath).map((row) => row.f_session_id)).toEqual(["s1", "s3", "s2"]);

      await workspace.detachSession(SessionId("s3"));
      expect(workspace.sessionIds.map(String)).toEqual(["s1", "s2"]);
      expect(membershipRows(dbPath).map((row) => row.f_session_id)).toEqual(["s1", "s2"]);
    } finally {
      await h.dispose();
    }
  });

  it("keeps an archived session that was never materialized across a restart", { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-archive-ghost-"));
    dirs.push(root);
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const dbPath = join(root, "sessions.sqlite");

    const first = await harness(dbPath, project);
    try {
      await first.registry.create(project);

      const phantom = SessionId("phantom");
      first.ctx.sessions.create(phantom, { meta: meta("phantom", first.canonical) });
      await first.registry.archiveSession(phantom);
      expect(first.registry.archivedSessionIds.map(String)).toEqual(["phantom"]);

      const db = new DatabaseSync(dbPath);
      try {
        const row = db
          .prepare(
            "SELECT f_head_sequence, f_cwd, f_seed_length, f_archived_at FROM t_sessions WHERE f_session_id = 'phantom'",
          )
          .get() as {
          f_head_sequence: number;
          f_cwd: string | null;
          f_seed_length: number | null;
          f_archived_at: number;
        };
        expect(row.f_head_sequence).toBe(-1);
        expect(row.f_cwd).toBeNull();
        expect(row.f_seed_length).toBeNull();
        expect(row.f_archived_at).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    } finally {
      await first.dispose();
    }

    const second = await harness(dbPath, project);
    try {
      expect(second.registry.archivedSessionIds.map(String)).toEqual(["phantom"]);
    } finally {
      await second.dispose();
    }
  });

  it("keeps the archive mark when a ghost session is later materialized", { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-archive-late-"));
    dirs.push(root);
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const dbPath = join(root, "sessions.sqlite");

    const first = await harness(dbPath, project);
    try {
      await first.registry.create(project);
      const phantom = SessionId("late");
      const live = first.ctx.sessions.create(phantom, { meta: meta("late", first.canonical) });
      await first.registry.archiveSession(phantom);

      await first.ctx.sessions.flush(live);
      expect(first.registry.archivedSessionIds.map(String)).toEqual(["late"]);
    } finally {
      await first.dispose();
    }

    const second = await harness(dbPath, project);
    try {
      expect(second.registry.archivedSessionIds.map(String)).toEqual(["late"]);
      const db = new DatabaseSync(dbPath);
      try {
        const row = db
          .prepare("SELECT f_cwd, f_archived_at FROM t_sessions WHERE f_session_id = 'late'")
          .get() as { f_cwd: string; f_archived_at: number };
        expect(row.f_cwd).toBe(second.canonical);
        expect(row.f_archived_at).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    } finally {
      await second.dispose();
    }
  });

  it("reloads membership order and archive state after a restart", { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "workspace-restart-"));
    dirs.push(root);
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const dbPath = join(root, "sessions.sqlite");

    const first = await harness(dbPath, project);
    try {
      const workspace = await first.registry.create(project);
      for (const id of ["a", "b", "c"]) {
        await workspace.attachSession(await seedSession(first.ctx, id, first.canonical));
      }
      await workspace.insertSessionBefore(SessionId("a"));
      await first.registry.archiveSession(SessionId("b"));
    } finally {
      await first.dispose();
    }

    const second = await harness(dbPath, project);
    try {
      const [workspace] = await second.registry.list();
      expect(workspace?.path).toBe(second.canonical);

      expect(workspace?.sessionIds.map(String)).toEqual(["c", "b", "a"]);
      expect(second.registry.archivedSessionIds.map(String)).toEqual(["b"]);
    } finally {
      await second.dispose();
    }
  });
});

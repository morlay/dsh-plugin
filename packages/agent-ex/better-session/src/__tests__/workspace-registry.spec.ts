import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SessionId } from "@morlay/dsh-session/contract";
import { StorageHub as Storage } from "@morlay/dsh-storage";
import { StorageDomainPlugin as StorageDomain } from "@morlay/dsh-storage";
import { WorkspacePlugin as Workspace } from "@morlay/dsh-workspace";
import { meta } from "@morlay/dsh-session/testing";
import { createCtx, mountOnto, type MountedContext as Context } from "./support/base.ts";

const dirs: string[] = [];
afterEach(async () => {
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
  const ctx = createCtx();
  await ctx.plugin(Storage);
  await ctx.plugin(StorageDomain, { backend: "rdb" });
  const fiber = await mountOnto(ctx, { config: { type: "sqlite", path: dbPath } });
  await ctx.plugin(Workspace);
  const registry = await waitFor(() => ctx.get("workspaceRegistry") as WorkspaceFace | undefined);
  return { ctx, registry, canonical, dispose: () => fiber.dispose() };
}

async function seedSession(ctx: Context, id: string, cwd: string): Promise<SessionId> {
  const sessionId = SessionId(id);
  const live = ctx.sessions.create(sessionId, { meta: meta(id, cwd) });
  await ctx.sessions.flush(live);
  return sessionId;
}

// 归属只住在 workspace 文档里（`t_storage_records` 的 `workspace / workspaces` 行），顺序就是数组顺序。
function membershipIds(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare(
        "SELECT f_key, f_value FROM t_storage_records WHERE f_domain = 'workspace' AND f_table = 'workspaces'",
      )
      .all() as Array<{ f_key: string; f_value: string }>;
    return rows.flatMap((row) => (JSON.parse(row.f_value) as { sessionIds: string[] }).sessionIds);
  } finally {
    db.close();
  }
}

describe("official workspace registry over the rdb storage backend", () => {
  it("attaches, reorders, and detaches membership as durable rows", async () => {
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
      expect(membershipIds(dbPath)).toEqual(["s3", "s2", "s1"]);

      await workspace.insertSessionBefore(SessionId("s1"), SessionId("s3"));
      expect(workspace.sessionIds.map(String)).toEqual(["s1", "s3", "s2"]);
      expect(membershipIds(dbPath)).toEqual(["s1", "s3", "s2"]);

      await workspace.detachSession(SessionId("s3"));
      expect(workspace.sessionIds.map(String)).toEqual(["s1", "s2"]);
      expect(membershipIds(dbPath)).toEqual(["s1", "s2"]);
    } finally {
      await h.dispose();
    }
  });

  it("keeps an archived session that was never materialized across a restart", async () => {
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

  it("keeps the archive mark when a ghost session is later materialized", async () => {
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

  it("reloads membership order and archive state after a restart", async () => {
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

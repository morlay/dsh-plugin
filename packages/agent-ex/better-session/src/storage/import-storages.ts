// 把 `<dshHome>/storages/*.json` 读进 RDB：workspace 文档（workspaces 表 + global）与投影检查点。
//
// 从源包 `session-rdb/src/import-storages.ts` 搬来。为什么是一次性脚本而不是装配行：这是换后端时
// 的搬运路径，源部署跑过一次就不再写 `storages/`——版本号盖进 `t_storage_units`，之后的域层按
// 「已接管」读回，不会再把旧文件搬第二遍。
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/contract";
import type {
  ProjectionCheckpoint,
  StorageRepository,
  WorkspaceDomainState,
  WorkspaceRecord,
} from "./types.ts";

interface ImportedProjcache {
  sessionId: SessionId;
  rows: ProjectionCheckpoint;
}

export interface StoragesImportResult {
  workspaces: number;

  workspaceState: boolean;

  projcache: number;
}

export interface StoragesImportOptions {
  dshHome: string;
}

const WORKSPACE_UNIT = "workspace";

/** workspace 文档接受的版本集（写进 `t_storage_units` 的是第一个，也是当前版本）。 */
export const WORKSPACE_UNIT_VERSIONS: ReadonlySet<number> = new Set([2]);

const PROJCACHE_UNIT = "session_projcache";

/** 投影检查点文档接受的版本集（`7` 是当前版本，`3`–`6` 是历史形状）。 */
export const PROJCACHE_UNIT_VERSIONS: ReadonlySet<number> = new Set([7, 3, 4, 5, 6]);

/**
 * 把一份 `storages/` 文件树搬进 RDB。
 *
 * @param repository - 目标库的 storage 面（与会话表同一个库）。
 * @param options - `dshHome`（`storages/` 的父目录）。
 * @returns 搬进去的条数（workspace 记录 / global 是否搬了 / 投影检查点条数）。
 */
export async function importStorages(
  repository: StorageRepository,
  options: StoragesImportOptions,
): Promise<StoragesImportResult> {
  const storagesRoot = join(options.dshHome, "storages");
  const result: StoragesImportResult = { workspaces: 0, workspaceState: false, projcache: 0 };

  const workspaceDocument = await readJson(join(storagesRoot, WORKSPACE_UNIT + ".json"));
  if (workspaceDocument !== undefined) {
    const tables = unitTables(workspaceDocument, WORKSPACE_UNIT, WORKSPACE_UNIT_VERSIONS);
    await repository.insertUnitVersion(
      WORKSPACE_UNIT,
      WORKSPACE_UNIT_VERSIONS.values().next().value as number,
    );
    for (const [id, record] of Object.entries(tables["workspaces"] ?? {})) {
      await repository.putDomainRecord("workspace", "workspaces", id, record as WorkspaceRecord);
      result.workspaces += 1;
    }
    if (workspaceDocument.global !== undefined && workspaceDocument.global !== null) {
      await repository.writeDomainGlobal(
        "workspace",
        workspaceDocument.global as WorkspaceDomainState,
      );
      result.workspaceState = true;
    }
  }

  const projcacheEntries = await readProjcacheEntries(storagesRoot);
  if (projcacheEntries.length > 0) {
    await repository.insertUnitVersion(
      PROJCACHE_UNIT,
      PROJCACHE_UNIT_VERSIONS.values().next().value as number,
    );
    for (const entry of projcacheEntries) {
      await repository.putProjcache(entry.sessionId, entry.rows);
      result.projcache += 1;
    }
  }

  return result;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function unitTables(
  document: Record<string, unknown>,
  name: string,
  versions: ReadonlySet<number>,
): Record<string, Record<string, unknown>> {
  const unit = document["unit"] as { name?: unknown; version?: unknown } | undefined;
  if (unit?.name !== name) {
    throw new Error("storages document is not the '" + name + "' unit");
  }
  if (typeof unit.version !== "number" || !versions.has(unit.version)) {
    throw new Error(
      "storages document '" +
        name +
        "' is stamped version " +
        String(unit.version) +
        ", not in the accepted set",
    );
  }
  const tables = document["tables"];
  if (typeof tables !== "object" || tables === null) {
    throw new Error("storages document '" + name + "' has no tables object");
  }
  return tables as Record<string, Record<string, unknown>>;
}

async function readProjcacheEntries(storagesRoot: string): Promise<ImportedProjcache[]> {
  const entries: ImportedProjcache[] = [];
  const sessionsDir = join(storagesRoot, PROJCACHE_UNIT, "sessions");
  let files: string[];
  try {
    files = (await readdir(sessionsDir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readLegacyProjcache(join(storagesRoot, PROJCACHE_UNIT + ".json"));
  }
  for (const file of files) {
    const document = (await readJson(join(sessionsDir, file))) as
      | { version?: unknown; record?: unknown }
      | undefined;
    if (document === undefined) continue;
    if (typeof document.version !== "number" || !PROJCACHE_UNIT_VERSIONS.has(document.version)) {
      continue;
    }
    const record = document.record as { identity?: unknown; rows?: unknown } | undefined;
    if (record === undefined || typeof record !== "object") continue;
    entries.push({
      sessionId: SessionId(file.slice(0, -".json".length)),
      rows: (record.rows ?? {}) as ProjectionCheckpoint,
    });
  }
  return entries;
}

async function readLegacyProjcache(path: string): Promise<ImportedProjcache[]> {
  const document = await readJson(path);
  if (document === undefined) return [];
  const tables = unitTables(document, PROJCACHE_UNIT, PROJCACHE_UNIT_VERSIONS);
  return Object.entries(tables["sessions"] ?? {}).map(([sessionId, record]) => {
    const value = record as { rows?: unknown };
    return {
      sessionId: SessionId(sessionId),
      rows: (value.rows ?? {}) as ProjectionCheckpoint,
    };
  });
}

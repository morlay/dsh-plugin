import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";

// 库身份：同一进程里指向同一个库的多个 `Database` 共用一条写队列（跨进程不承诺）。
//
// SQLite 取文件的实际 `dev:ino`（重命名 / 相对路径都不影响）；PostgreSQL 取连接串的
// host + database 与 schema——同一个库上的不同实例也必须排队，否则 `serializable` 会互相撞。
export function sqliteLibraryKey(path: string): string {
  if (path === "" || path === ":memory:" || path.startsWith("file::memory:")) {
    // 内存库彼此独立：每个实例都是一个新库，不能共享队列。
    return `sqlite:memory:${randomUUID()}`;
  }
  const absolute = resolve(path);
  try {
    // `openSqlite` 是同步入口（`DatabaseSync`），库身份键必须在同一处算完。
    // oxlint-disable-next-line node/no-sync -- 同步驱动与同步键计算必须在一起
    const stats = statSync(absolute);
    return `sqlite:${String(stats.dev)}:${String(stats.ino)}`;
  } catch {
    return `sqlite:path:${absolute}`;
  }
}

export function postgresLibraryKey(connectionString: string, schema: string | undefined): string {
  const url = new URL(connectionString);
  return `postgres:${url.host}${url.pathname}:${schema ?? "public"}`;
}

// 身份名的 32 位指纹（FNV-1a）：SQLite 只能把身份存进 `application_id`（32 位整数），
// 所以两方言统一用指纹判「同一个身份」，版本单独存。
export function identityFingerprint(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fingerprintHex(name: string): string {
  return identityFingerprint(name).toString(16);
}

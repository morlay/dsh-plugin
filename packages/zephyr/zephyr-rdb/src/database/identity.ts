import { DbError } from "../error.ts";
import { fragment } from "../fragment.ts";
import { fingerprintHex, identityFingerprint } from "./library.ts";
import type { Database } from "./types.ts";

// 域层声明的库身份：我是谁、版本多少。库只负责记住并校验，不解释这两个字段。
export interface LibraryIdentity {
  readonly name: string;
  readonly version: number;
}

// 库里的身份：名字只存 32 位指纹（SQLite 的 `application_id` 是整数），版本单独存。
export interface StoredIdentity {
  readonly fingerprint: string;
  readonly version: number;
}

export const IDENTITY_MISMATCH_CODE = "ZEPHYR_RDB_IDENTITY_MISMATCH";

// 版本不符 / 不是同一个库：拒绝打开，而不是往别人的库里继续写。
export function identityMismatchError(stored: StoredIdentity, expected: LibraryIdentity): DbError {
  return new DbError(
    "identity",
    `zephyr-rdb: library identity mismatch: expected ${fingerprintHex(expected.name)}@${String(expected.version)}, database has ${stored.fingerprint}@${String(stored.version)}`,
    { code: IDENTITY_MISMATCH_CODE },
  );
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0 || version > 2_147_483_647) {
    throw new Error(
      `zephyr-rdb: library identity version must be a non-negative int32, got ${String(version)}`,
    );
  }
}

// SQLite：`application_id` 存身份指纹（32 位有符号），`user_version` 存版本。
async function readSqliteIdentity(database: Database): Promise<StoredIdentity | undefined> {
  const [applicationId] = await database.read<{ application_id: number }>(
    fragment("PRAGMA application_id"),
  );
  const fingerprint = Number(applicationId?.application_id ?? 0) >>> 0;
  // 0 是「未设置」：空库与没写身份的库都读到这里。
  if (fingerprint === 0) return undefined;
  const [version] = await database.read<{ user_version: number }>(fragment("PRAGMA user_version"));
  return { fingerprint: fingerprint.toString(16), version: Number(version?.user_version ?? 0) };
}

async function writeSqliteIdentity(database: Database, identity: LibraryIdentity): Promise<void> {
  // PRAGMA 不支持绑定参数：值只来自指纹（int32）与版本（int32），内联是安全的。
  const fingerprint = identityFingerprint(identity.name) | 0;
  await database.run(fragment(`PRAGMA application_id = ${String(fingerprint)}`));
  await database.run(fragment(`PRAGMA user_version = ${String(identity.version)}`));
}

// PostgreSQL：身份写在 schema 的注释上（`zephyr-rdb:<指纹>:<版本>`），不额外建表。
const IDENTITY_COMMENT_PREFIX = "zephyr-rdb:";

async function readPostgresIdentity(database: Database): Promise<StoredIdentity | undefined> {
  const rows = await database.read<{ comment: string | null }>(
    fragment(
      "SELECT obj_description(n.oid, 'pg_namespace') AS comment FROM pg_namespace n WHERE n.nspname = ?",
      [database.schema ?? "public"],
    ),
  );
  const comment = rows[0]?.comment;
  if (typeof comment !== "string" || !comment.startsWith(IDENTITY_COMMENT_PREFIX)) {
    return undefined;
  }
  const [fingerprint, version] = comment.slice(IDENTITY_COMMENT_PREFIX.length).split(":");
  if (fingerprint === undefined || version === undefined) return undefined;
  return { fingerprint, version: Number(version) };
}

async function writePostgresIdentity(database: Database, identity: LibraryIdentity): Promise<void> {
  const schema = database.schema ?? "public";
  const comment = `${IDENTITY_COMMENT_PREFIX}${fingerprintHex(identity.name)}:${String(identity.version)}`;
  // schema 名过方言的标识符校验；注释文本只含十六进制与数字，没有引号可逃逸。
  await database.run(
    fragment(`COMMENT ON SCHEMA ${database.dialect.quote(schema)} IS '${comment}'`),
  );
}

// 读库身份；没写过（或空库）时是 undefined。
export function readIdentity(database: Database): Promise<StoredIdentity | undefined> {
  return database.dialect.name === "sqlite"
    ? readSqliteIdentity(database)
    : readPostgresIdentity(database);
}

// 写库身份（覆盖）：域层只在「认领这个库」时调一次，之后由打开时校验。
export async function writeIdentity(database: Database, identity: LibraryIdentity): Promise<void> {
  assertVersion(identity.version);
  if (database.dialect.name === "sqlite") {
    await writeSqliteIdentity(database, identity);
    return;
  }
  await writePostgresIdentity(database, identity);
}

// 打开时的身份校验：没写过就写入；写过就必须是同一个身份、同一个版本。
export async function applyIdentity(database: Database, identity: LibraryIdentity): Promise<void> {
  assertVersion(identity.version);
  const stored = await readIdentity(database);
  if (stored === undefined) {
    await writeIdentity(database, identity);
    return;
  }
  const expected = fingerprintHex(identity.name);
  if (stored.fingerprint !== expected || stored.version !== identity.version) {
    throw identityMismatchError(stored, identity);
  }
}

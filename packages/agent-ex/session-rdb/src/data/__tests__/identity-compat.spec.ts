// 库身份的两件兼容事：
//   1. 本仓更早版本写在 `application_id` 上的旧身份（ASCII "DSHP" = 0x44534850）要**就地升级**成当前
//      指纹，而不是把用户正在用的库判成别人的库（删库不是选项）。
//   2. 32 位 `application_id` 的写入侧只能是 int32（SQLite 把超出 int32 的十进制静默写成 0），
//      读回侧是同一段 32 位的无符号表示：所以写入保持有符号，比较前两侧归一。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openRdbBackend,
  SCHEMA_VERSION,
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
} from "@morlay/session-rdb";
import { identityFingerprint } from "@morlay/zephyr-rdb";
import { openSqliteHandle } from "@morlay/zephyr-rdb/testing";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { classifyStoredApplicationId } from "../store/identity.ts";

// 本库更早版本用的身份魔数（ASCII "DSHP"）：用户库上读到的就是这个值。
const LEGACY_APPLICATION_ID = 0x44534850; // 1146308688

// 归一：有符号 int32 与无符号 32 位是同一个身份（比较前两侧都走这里）。
function normalize(value: number): number {
  return value >>> 0;
}

// rdb 的 `readIdentity().fingerprint` 是十六进制字符串：解析后同样是那 32 位。
function fingerprintNumber(fingerprint: string): number {
  return normalize(Number.parseInt(fingerprint, 16));
}

async function tempDatabasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-identity-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return join(root, "sessions.sqlite");
}

function openBackend(path: string): Promise<Awaited<ReturnType<typeof openRdbBackend>>> {
  return openRdbBackend({ type: "sqlite", path, journalMode: "wal", busyTimeout: 5000 });
}

const CURRENT_FINGERPRINT = normalize(identityFingerprint("dsh-session"));

describe("库身份兼容（旧身份 / 32 位表示）", () => {
  test("旧身份库（application_id = 1146308688）能打开，且打开后就地升级为新指纹", async () => {
    const path = await tempDatabasePath();
    // 一份**本仓早先版本写下的库**：结构齐全（user_version = SCHEMA_VERSION），身份还是旧魔数。
    const original = await openBackend(path);
    const storeIdentity = original.storeIdentity;
    await original.close();
    const legacy = openSqliteHandle(path);
    legacy.exec(`PRAGMA application_id = ${String(LEGACY_APPLICATION_ID)}`);
    expect(legacy.prepare("PRAGMA application_id").get()).toEqual({
      application_id: LEGACY_APPLICATION_ID,
    });
    legacy.close();

    // 打开：认成本库旧身份、原地升级，不抛 SESSION_STORAGE_INCOMPATIBLE。
    const upgraded = await openBackend(path);
    const stored = await upgraded.database.readIdentity();
    await upgraded.close();

    expect(stored?.version).toBe(SCHEMA_VERSION);
    expect(fingerprintNumber(stored?.fingerprint ?? "0")).toBe(CURRENT_FINGERPRINT);
    // 升级写的就是当前指纹（读回按归一后的值比）。
    const after = openSqliteHandle(path);
    expect(
      normalize(Number(after.prepare("PRAGMA application_id").get()?.["application_id"])),
    ).toBe(CURRENT_FINGERPRINT);
    expect(after.prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION });
    after.close();

    // 库没被重建：store id 还是原来那一份，升级只是一次身份改写。
    const reopened = await openBackend(path);
    expect(reopened.storeIdentity).toBe(storeIdentity);
    await reopened.close();
  });

  test("只有旧身份戳、还没有结构的旧库也能打开并升级", async () => {
    const path = await tempDatabasePath();
    const legacy = openSqliteHandle(path);
    legacy.exec(`PRAGMA application_id = ${String(LEGACY_APPLICATION_ID)}`);
    legacy.close();

    const backend = await openBackend(path);
    const stored = await backend.database.readIdentity();
    await backend.close();

    expect(stored?.version).toBe(SCHEMA_VERSION);
    expect(fingerprintNumber(stored?.fingerprint ?? "0")).toBe(CURRENT_FINGERPRINT);
  });

  test("新指纹写入后重开不报错（有符号写入与无符号读回是同一表示）", async () => {
    const path = await tempDatabasePath();
    const first = await openBackend(path);
    const stored = await first.database.readIdentity();
    const rawStamp = await first.database.sqlitePragma("application_id");
    await first.close();

    // 写入侧是有符号 int32，读回侧是同一段 32 位的无符号表示：归一后是同一个身份。
    expect(normalize(Number(rawStamp))).toBe(normalize(SESSION_PERSISTENCE_SQLITE_APPLICATION_ID));
    expect(fingerprintNumber(stored?.fingerprint ?? "0")).toBe(CURRENT_FINGERPRINT);

    const reopened = await openBackend(path);
    const again = await reopened.database.readIdentity();
    await reopened.close();

    expect(again?.version).toBe(SCHEMA_VERSION);
    expect(fingerprintNumber(again?.fingerprint ?? "0")).toBe(CURRENT_FINGERPRINT);
  });

  test("同一 32 位的两种表示是同一个身份：有符号写入 / 无符号读回都认成当前身份", () => {
    // 写入值是 int32（-80036999），读回口径是无符号 32 位（4214930297）：比较前两侧都归一，
    // 否则新库每次启动都会被判成「别人的库」。
    expect(classifyStoredApplicationId(SESSION_PERSISTENCE_SQLITE_APPLICATION_ID)).toBe("current");
    expect(classifyStoredApplicationId(normalize(SESSION_PERSISTENCE_SQLITE_APPLICATION_ID))).toBe(
      "current",
    );
    expect(classifyStoredApplicationId(LEGACY_APPLICATION_ID)).toBe("legacy");
    expect(classifyStoredApplicationId(12345)).toBe("foreign");
  });

  test("不认识的 application_id 仍拒绝（库原样不动）", async () => {
    const path = await tempDatabasePath();
    const foreign = openSqliteHandle(path);
    foreign.exec("PRAGMA application_id = 12345");
    foreign.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
    foreign.close();

    const failure = await openBackend(path).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "SESSION_STORAGE_INCOMPATIBLE" });
    expect((failure as Error).message).toMatch(/has application id 12345/);

    const unchanged = openSqliteHandle(path);
    expect(unchanged.prepare("PRAGMA application_id").get()).toEqual({ application_id: 12345 });
    expect(unchanged.prepare("PRAGMA user_version").get()).toEqual({
      user_version: SCHEMA_VERSION,
    });
    expect(unchanged.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
    unchanged.close();
  });

  test("application_id 只按 int32 收：无符号值会被吞成 0，所以写入侧必须保持有符号", async () => {
    const path = await tempDatabasePath();
    const sqlite = openSqliteHandle(path);
    // 归一后的无符号值（4214930297）超出 int32，SQLite 静默写成 0——身份就没了。
    sqlite.exec(
      `PRAGMA application_id = ${String(normalize(SESSION_PERSISTENCE_SQLITE_APPLICATION_ID))}`,
    );
    expect(sqlite.prepare("PRAGMA application_id").get()).toEqual({ application_id: 0 });
    // 有符号值（-80036999）落在 int32 里：读回来的就是那 32 位。
    sqlite.exec(`PRAGMA application_id = ${String(SESSION_PERSISTENCE_SQLITE_APPLICATION_ID)}`);
    expect(sqlite.prepare("PRAGMA application_id").get()).toEqual({
      application_id: SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
    });
    sqlite.close();
  });
});

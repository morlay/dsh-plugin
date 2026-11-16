// `session_mode` 域的读写：真 json 后端 + 临时 `DSH_HOME`，关掉再开读回来一致，坏记录不阻断。
//
// 装法照 `dsh-storage/src/__tests__/storage.spec.ts`：真 hub + 真域行 + 真 json 后端（只在临时目录落盘）。
// 被测的是本包的域声明与三个动作（`read` / `write` / `remove`），中间没有替身。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { StorageDomain } from "@morlay/dsh-storage/contract";
import {
  StorageJsonDefault,
  provideStorage,
  provideStorageJson,
} from "@morlay/dsh-storage";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_MODE_TABLE,
  SessionModeOverrides,
  sessionModeDomainSpec,
} from "@morlay/session-mode";

const roots: string[] = [];
const apps: { dispose(): Promise<void> }[] = [];

beforeEach(async () => {
  roots.push(await mkdtemp(join(tmpdir(), "session-mode-store-")));
});

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// 起一套真的存储栈：hub + 域行 + 上游 json 后端，根目录在这次用例的临时目录下。
async function boot(): Promise<StorageDomain> {
  const root = roots.at(-1) ?? "";
  const app = await bootstrapApplication({
    providers: [
      ...provideStorage(),
      ...provideStorageJson(configure(StorageJsonDefault, { root: join(root, "storages") })),
    ],
    timeoutMs: 10_000,
  });
  apps.push(app);
  return app.get(StorageDomain);
}

// 一条"关掉再开"的读回：写与读发生在两次独立的 `open` 上（同一个后端目录）。
async function withinLatest<T>(
  run: (storage: StorageDomain, warn: string[]) => Promise<T>,
): Promise<{ value: T; warned: string[] }> {
  const storage = await boot();
  const warned: string[] = [];
  try {
    return { value: await run(storage, warned), warned };
  } finally {
    await storage.closeAll();
  }
}

describe("session_mode 域的读写", () => {
  it("写一条覆盖，关掉再开读回来一致", async () => {
    const id = SessionId("session-store-roundtrip");

    // 第一次：写一条字段级覆盖（只带两个字段）。
    await withinLatest(async (storage) => {
      const store = new SessionModeOverrides(storage, () => {});
      await store.write(id, { allowTools: ["read"], instructions: false });
      await store.close();
    });

    // 第二次：全新的 open（数据来自 json 后端，不是内存残留）。
    const { value } = await withinLatest(async (storage) => {
      const store = new SessionModeOverrides(storage, () => {});
      const record = await store.read(id);
      await store.close();
      return record;
    });

    expect(value).toEqual({ allowTools: ["read"], instructions: false });
  });

  it("删掉记录之后读回来是 undefined", async () => {
    const id = SessionId("session-store-remove");

    await withinLatest(async (storage) => {
      const store = new SessionModeOverrides(storage, () => {});
      await store.write(id, { denyTools: ["bash"] });
      await store.remove(id);
      await store.close();
    });

    const { value } = await withinLatest(async (storage) => {
      const store = new SessionModeOverrides(storage, () => {});
      const record = await store.read(id);
      await store.close();
      return record;
    });

    expect(value).toBeUndefined();
  });

  it("坏记录不阻断，按没有覆盖处理（并 warn 一条）", async () => {
    const id = SessionId("session-store-corrupt");
    const corrupt = { allowTools: "not-an-array" };

    // 绕过 `write`（它会挡住形状不对的记录），直接往域里塞一条坏记录：模拟手改过 / 旧版本写下的介质。
    await withinLatest(async (storage) => {
      const domain = await storage.open(sessionModeDomainSpec);
      await domain.table(SESSION_MODE_TABLE).put(id, corrupt);
      await domain.close();
    });

    // 重新 open：坏记录**不阻断**装配（域层 schema 是宽的），读面按「没有覆盖」处理。
    const { value, warned } = await withinLatest(async (storage, warn) => {
      const store = new SessionModeOverrides(storage, (message) => warn.push(message));
      const record = await store.read(id);
      await store.close();
      return record;
    });

    expect(value).toBeUndefined();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("按没有覆盖处理");
  });

  it("空记录按没有覆盖处理（清到空的字段不留空壳）", async () => {
    const id = SessionId("session-store-empty");

    await withinLatest(async (storage) => {
      const domain = await storage.open(sessionModeDomainSpec);
      await domain.table(SESSION_MODE_TABLE).put(id, {});
      await domain.close();
    });

    const { value } = await withinLatest(async (storage) => {
      const store = new SessionModeOverrides(storage, () => {});
      const record = await store.read(id);
      await store.close();
      return record;
    });

    expect(value).toBeUndefined();
  });
});
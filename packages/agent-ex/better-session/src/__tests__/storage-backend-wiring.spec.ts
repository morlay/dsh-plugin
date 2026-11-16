// 跨面装配（留根）：storage 域（hub + domain）与会话持久化的 **storage 接管**装在同一份清单里，
// 跑真内核（`bootstrapApplication`），而不是本包 `support/base.ts` 那种按清单顺序逐行挂的替身装配。
//
// 为什么这条链在别处测不到：better-session 的整装用例一律 `provideBetterSession(without(StorageTakeoverDefault))`
// （它们不装 storage hub），于是「storage 接管行 + storage-domain 行」这条链从未被任何用例穿过。
// 症状是启动即 `StorageError: storage backend 'rdb' is not registered (registered: none)`。
//
// 清单与生产同形（`apps/zephyr-custom/src/zephyr.provide.ts` 的两组行）：storage 域由装配面按
// `configure(StorageDomainDefault, { backend: "rdb" })` 路由到 RDB，后端由 `provideBetterSession` 里的
// `StorageTakeoverDefault` 注册。这里只补本包清单缺不了的宿主行（会话存储 / 投影注册表 / wire 路由表）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { AppEnvDefault, RemoteHandlersDefault, provideAppEnv } from "@morlay/zephyr-app";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { Storage, StorageDomain, StorageDomainDefault, provideStorage } from "@morlay/dsh-storage";
import { afterEach, describe, expect, it } from "vitest";
import { SessionPersistenceRdb } from "@morlay/better-session";
import { provideBetterSession } from "@morlay/better-session/server";

const apps: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** 起一份与生产同形的清单：storage 域 + 会话持久化（含 storage 接管）。 */
async function assemble(): Promise<App> {
  const root = await mkdtemp(join(tmpdir(), "storage-backend-wiring-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [
      ...provideAppEnv(configure(AppEnvDefault, { profileDir: root, dataDir: root })),
      // 本包清单缺不了的宿主行：会话存储、投影注册表、wire 路由表。
      ...provideSession(),
      ...provideSessionProjection(),
      RemoteHandlersDefault,
      // 生产装配的第 119 行：KV 域路由到 `rdb`。
      ...provideStorage(configure(StorageDomainDefault, { backend: "rdb" })),
      // 生产装配的第 122 行（会话核心）：`StorageTakeoverDefault` 在这一份里注册 `rdb`。
      ...provideBetterSession(
        configure(SessionPersistenceRdb, {
          type: "sqlite",
          path: join(root, "sessions", "sessions.sqlite"),
        }),
      ),
      // 生产装配的第 138 行（workspace 域）：它挂载上游 workspace 插件，那条插件在 init 里就
      // `storageDomain.open("workspace")`——storage 后端必须已经在 hub 上、会话库必须已经打开。
      ...provideWorkspace(),
    ],
    timeoutMs: 30_000,
  });
  apps.push(app);
  return app;
}

describe("storage 后端接管与 storage 域在同一份清单里", () => {
  it("rdb 已经注册进 hub、按后端名发布，且 storage 域解析得到", async () => {
    const app = await assemble();
    const hub = app.get(Storage);

    // 注册：`StorageTakeoverDefault.onInit` 的 `storage.backend.register("rdb", …)`。
    expect(hub.backend.names()).toContain("rdb");
    expect(hub.backend.get("rdb")).toBeDefined();
    // 发布：上游 storage-domain 一族按 `storage.backend.<名字>` 等后端就绪。
    expect(app.ctx.get("storage.backend.rdb", false)).toBeDefined();
    // 同一个 hub 上的域行（KV 域按它的路由表找 `rdb`）。
    expect(app.get(StorageDomain)).toBeInstanceOf(StorageDomain);
  });

  // 本包的两条会话行**不静态注入** `WorkspaceRegistry`（那会与 `Workspace` 行成环，把 workspace 行
  // 排到 storage 接管之前），改在调用时按**上游注册名**读。这条守住那个口径：名字读得到、且是真面。
  it("工作区注册表按上游名读得到（会话行调用时取的正是它）", async () => {
    const app = await assemble();

    // 会话行读的就是这个名字（`admin/workspace-registry.read.ts`：先派生名、再上游别名）。
    // 读到的是 cordis 的 traceable 代理（同一份实现的调用面），所以按行为断言，不比对象同一性。
    const byName = app.ctx.reflect.get("workspaceRegistry", false);
    expect(byName).toBeDefined();
    expect((byName as WorkspaceRegistry).archivedSessionIds).toEqual(
      app.get(WorkspaceRegistry).archivedSessionIds,
    );
  });

  it("rdb 后端真的可用：KV 单元开在会话库上", async () => {
    const app = await assemble();
    const backend = app.get(Storage).backend.get("rdb");

    const unit = await backend.kv!.open({
      name: "probe",
      version: 1,
      tables: ["probes"],
      hasGlobal: true,
    });
    await unit.putRecord("probes", "p1", { note: "wired" });
    expect((await unit.loadAll()).tables["probes"]).toEqual({ p1: { note: "wired" } });
    await unit.close();
  });
});

// `schedule/*` 的六个宿主端点：真上游 `ScheduleService`（`ScheduleRow` 接管的那个实例）+ 真 storage domain。
//
// 判据落在上游自己的行为上（不是「注册上了」）：
// - `catalog` / `deleteInactive` 是**无参**端点，真跑到底、回真结构；
// - `history` / `delete` / `update` 对不认识的计划回上游的结构化失败（`schedule/not-found` 一类），
//   不是「没有实现」；
// - `list` 对一个还没有计划表的会话回空表。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent/server";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { provideStorage } from "@morlay/dsh-storage";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-working-directory";
import { bootstrapApplication, Injectable, type App, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, type AppEnvValues } from "@morlay/zephyr-app";
import { RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduleRow } from "../server/schedule.service.ts";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  // 先让 storage domain 的异步收尾（`serialize()` 队列、事件驱动的 `requestDrive`）落定再拆栈：
  // 直接 dispose 会让 json 后端在 domain 单元仍在打开时 close，抛一条 teardown 期未处理拒绝。
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** 指向本用例临时目录的运行环境。 */
function fakeAppEnvOf(root: string): new () => AppEnv {
  @Injectable()
  class FakeAppEnv extends AppEnv {
    readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false, aggregate: [] };

    readonly cacheDir = join(root, "cache");

    readonly packageRoot = root;

    readonly appBootDir = join(root, "boot");

    readonly profileManifest = join(root, "package.json");
  }
  return FakeAppEnv;
}

/** 起 `schedule/*` 的宿主栈（真 storage domain + 真持久化）。 */
async function boot(): Promise<{ app: App; handlers: RemoteHandlers }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-schedule-"));
  roots.push(root);
  const FakeAppEnv = fakeAppEnvOf(root);
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(), ...provideTypert(),
    
      FakeAppEnv,
      ...provideAgent(),
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      SubprocessDefault,
      SandboxDefault,
      configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root })([SandboxPolicyDefault]),
      FsSandbox,
      SessionPersistenceDefault,
      ...provideStorage(),
      ...providePersistence(configure(StorageJsonDefault, { root: join(root, "storages") })),
      RemoteHandlersDefault,
      ScheduleRow,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return { app, handlers: app.get(RemoteHandlers) };
}

/** wire 回的 `RemoteResult`：按判别式收窄，不靠断言。 */
function errorOf(value: unknown): { code?: string; message?: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("ok" in value) || value.ok !== false) return undefined;
  if (!("error" in value) || typeof value.error !== "object" || value.error === null) return undefined;
  return value.error;
}

/** wire 回的成功值（没有就 `undefined`）。 */
function okOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("ok" in value) || value.ok !== true) return undefined;
  return "value" in value ? value.value : undefined;
}

describe("schedule/* 的宿主面", { timeout: 30_000 }, () => {
  it("catalog（无参）真跑到底，回注册表里的目录数组", async () => {
    const { handlers } = await boot();
    const value = okOf(await handlers.invoke("schedule/catalog", {}));
    expect(Array.isArray(value)).toBe(true);
  });

  it("deleteInactive（无参）真跑到底，回删除结果", async () => {
    const { handlers } = await boot();
    const value = okOf(await handlers.invoke("schedule/deleteInactive", {}));
    expect(value).toBeDefined();
    // 上游 `ScheduleDeleteInactiveResult`：至少带删除计数一类的字段。
    expect(typeof value).toBe("object");
  });

  it("list 对没有计划表的会话回空表", async () => {
    const { handlers } = await boot();
    const value = okOf(await handlers.invoke("schedule/list", { request: { sessionId: "s-none" } }));
    expect(value).toEqual([]);
  });

  it("history 对不认识的计划回上游的结构化失败", async () => {
    const { handlers } = await boot();
    const result = await handlers.invoke("schedule/history", {
      request: { sessionId: "s-none", scheduleId: "nope" },
    });
    expect(errorOf(result)).toBeDefined();
  });

  it("delete 对不认识的计划回**非变更结果**（上游语义：`deleted: false` + `schedule_not_found`）", async () => {
    const { handlers } = await boot();
    const value = okOf(
      await handlers.invoke("schedule/delete", {
        request: { sessionId: "s-none", id: "nope" },
      }),
    );
    expect(value).toMatchObject({ id: "nope", deleted: false, code: "schedule_not_found" });
  });

  it("update 对不认识的计划回**非变更结果**（上游语义：`updated: false` + `schedule_not_found`）", async () => {
    const { handlers } = await boot();
    const value = okOf(
      await handlers.invoke("schedule/update", {
        request: { sessionId: "s-none", id: "nope", expected: {} },
      }),
    );
    expect(value).toMatchObject({ id: "nope", updated: false, code: "schedule_not_found" });
  });
});

// host 侧 workspace 的**真装配**（真 storage + 真持久化）：
// 「选目录 → workspace/create」必须真的落盘，并让活跃的 follow 流收到 upsert。
//
// 这条也守住装配面的一条硬要求：`WorkspaceRegistry` 读 `ctx.logger`，所以 `Workspace` 行必须显式把
// `Logger` 交进去——缺了它 mount 就会失败（而不是在 `reportFilteredCandidates` 里变成
// `Cannot read properties of undefined (reading 'warn')` 这种不可读的运行时错误）。
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DirectoryPickerCapability } from "@deepseek-ai/dsh-host-directory-picker";
import { bootstrapApplication, Injectable, configure } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { provideRemoteAccess, RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { DirectoryPickerBackend, Workspace } from "@morlay/dsh-workspace";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { SessionControllerHost } from "@morlay/dsh-session/server";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { provideStorage } from "@morlay/dsh-storage";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";
import { SessionWorkspaceHost } from "../session-workspace.host.ts";
import { WorkspaceControllerRow } from "../workspace-controller.host.ts";
import { FakeAppEnv } from "./support/fake-app-env.ts";

/** 目录选择不参与这条用例，但要满足 controller 的依赖。 */
@Injectable()
class NoopPicker extends DirectoryPickerBackend {
  capability(): DirectoryPickerCapability {
    return { kind: "native", pick: async (): Promise<null> => null };
  }
}

const opened: { dispose(): Promise<void> }[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** 起真 host 栈（storage 落临时目录）。 */
async function boot(): Promise<{ handlers: RemoteHandlers; dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "dsh-workspace-"));
  roots.push(dataDir);
  FakeAppEnv.root = dataDir;
  const app = await bootstrapApplication({
    providers: [...provideTypert(), ...provideRemoteAccess(),
    
      FakeAppEnv,
      ...provideStorage(),
      ...providePersistence(configure(StorageJsonDefault, { root: join(dataDir, "storages") })),
      SessionPersistenceDefault,
      Workspace,
      WorkspaceBroadcaster,
      NoopPicker,
      RemoteHandlersDefault,
      WorkspaceControllerRow,
      SessionWorkspaceHost,
      SessionStoreDefault,
      SessionControllerHost,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return { handlers: app.get(RemoteHandlers), dataDir };
}

describe("workspace/create 的真装配", { timeout: 30_000 }, () => {
  it("落到持久化，并让活跃的 follow 流收到 upsert", async () => {
    const { handlers, dataDir } = await boot();
    const workspacePath = join(dataDir, "项目");
    await mkdir(workspacePath);
    // registry 存的是 canonical 路径（macOS 上 `/var` → `/private/var`）。
    const canonical = await realpath(workspacePath);

    const controller = new AbortController();
    const source = handlers.stream(
      "workspace/follow",
      {},
      controller.signal,
    ) as AsyncIterable<unknown>;
    const iterator = source[Symbol.asyncIterator]();
    const baseline = (await iterator.next()) as {
      value?: { type?: string; value?: { items?: unknown[] } };
    };
    expect(baseline.value?.type).toBe("baseline");
    expect(baseline.value?.value?.items).toEqual([]);

    const result = (await handlers.invoke("workspace/create", {
      request: { path: workspacePath },
    })) as { ok?: boolean; value?: { created?: boolean; workspace?: { path?: string } } };
    expect(result.ok, `create 失败：${JSON.stringify(result)}`).toBe(true);
    expect(result.value?.created).toBe(true);
    expect(result.value?.workspace?.path).toBe(canonical);

    // 列表要能看见：upsert 帧必须到达活跃的 follow 流。
    const upsert = (await iterator.next()) as {
      value?: { type?: string; workspace?: { path?: string } };
    };
    expect(upsert.value?.type).toBe("upsert");
    expect(upsert.value?.workspace?.path).toBe(canonical);
    controller.abort();

    // 持久化：storage domain 里应当有这条记录。
    const stored = await readFile(join(dataDir, "storages", "workspace.json"), "utf8");
    expect(stored).toContain(canonical);
  });

  it("同一目录再建一次是幂等的（created=false）", async () => {
    const { handlers, dataDir } = await boot();
    const workspacePath = join(dataDir, "项目");
    await mkdir(workspacePath);

    const first = (await handlers.invoke("workspace/create", {
      request: { path: workspacePath },
    })) as {
      ok?: boolean;
      value?: { created?: boolean };
    };
    expect(first.ok).toBe(true);
    expect(first.value?.created).toBe(true);

    const second = (await handlers.invoke("workspace/create", {
      request: { path: workspacePath },
    })) as {
      ok?: boolean;
      value?: { created?: boolean };
    };
    expect(second.ok).toBe(true);
    expect(second.value?.created).toBe(false);
  });
});

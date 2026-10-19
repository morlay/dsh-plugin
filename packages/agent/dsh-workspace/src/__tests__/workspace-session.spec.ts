// host 侧「workspace 下建会话」的**真装配**：真 storage + 真 WorkspaceController + 真会话服务 + 真 jsonl 持久化
// （落临时目录）。这里要断的是**契约调用与顺序**：header 先落盘，再 attach，再广播。
//
// 守的是这条链：`session/create { workspaceId }` → 落 header → `workspace.attachSession`（按 header 的 cwd 校验）
// → `workspace.sessionIds` 变化 → follow 流推出 upsert（页面上的工作区下才会出现会话行）。
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DirectoryPickerCapability } from "@deepseek-ai/dsh-host-directory-picker";
import { bootstrapApplication, Injectable, configure } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { provideRemoteAccess, RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { DirectoryPickerBackend, Workspace } from "@morlay/dsh-workspace";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { RemoteSessionHost, SessionControllerHost } from "@morlay/dsh-session/server";
import { SessionEndpointDefault } from "@morlay/dsh-session/server";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { provideStorage } from "@morlay/dsh-storage";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { afterEach, describe, expect, it } from "vitest";
import { SessionWorkspaceHost } from "../session-workspace.host.ts";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";
import { WorkspaceControllerRow } from "../workspace-controller.host.ts";
import { FakeAppEnv } from "./support/fake-app-env.ts";

/**
 * 上游 `SessionController` 的占位：这里走的是目录端点（list/create/page/follow），不碰会话语义端点。
 */
@Injectable()
class FakeRemoteSessionHost extends RemoteSessionHost {
  readonly typertRemote = { namespace: "session", methods: [] };
}

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

async function boot(): Promise<{
  handlers: RemoteHandlers;
  dataDir: string;
  persistence: SessionPersistenceDefault;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "dsh-workspace-session-"));
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
      FakeRemoteSessionHost,
      SessionEndpointDefault,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return {
    handlers: app.get(RemoteHandlers),
    dataDir,
    persistence: app.get(SessionPersistenceDefault),
  };
}

describe("workspace 下建会话（真装配）", { timeout: 30_000 }, () => {
  it("落 header、挂到 workspace、并推出 upsert", async () => {
    const { handlers, dataDir, persistence } = await boot();
    const workspacePath = join(dataDir, "项目");
    await mkdir(workspacePath);
    const canonical = await realpath(workspacePath);

    const created = (await handlers.invoke("workspace/create", {
      request: { path: workspacePath },
    })) as { ok?: boolean; value?: { workspace?: { workspaceId?: string } } };
    const workspaceId = created.value?.workspace?.workspaceId;
    expect(workspaceId).toBeDefined();

    const controller = new AbortController();
    const source = handlers.stream(
      "workspace/follow",
      {},
      controller.signal,
    ) as AsyncIterable<unknown>;
    const iterator = source[Symbol.asyncIterator]();
    await iterator.next(); // baseline

    const session = (await handlers.invoke("session/create", {
      request: { workspaceId },
    })) as { sessionId?: string };
    expect(session.sessionId).toBeDefined();

    // 会话 header 落在持久化面里，且带 workspace 的目录（attach 的校验依据）。
    const stored = await persistence.list();
    expect(stored.map((snapshot) => snapshot.header.cwd)).toContain(canonical);

    // 工作区下要有这个会话：attach 之后 sessionIds 变化 → upsert 帧。
    const upsert = (await iterator.next()) as {
      value?: { type?: string; workspace?: { sessionIds?: readonly string[] } };
    };
    expect(upsert.value?.type).toBe("upsert");
    expect(upsert.value?.workspace?.sessionIds).toContain(session.sessionId ?? "");
    controller.abort();
  });
});

// host 侧 workspace 面（mock client）：直接调 `RemoteHandlers`，不经 socket。
//
// 守两件事：`workspace/follow` 的首帧是 registry 的 baseline（`ui-workspace` 靠它长出列表），
// 以及 `workspace/create` 真的落到 registry 上（命令不是桩）。
import type { DirectoryPickerCapability } from "@deepseek-ai/dsh-host-directory-picker";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault, provideRemoteAccess, provideTypert } from "@morlay/zephyr-app";
import { DirectoryPickerBackend } from "@morlay/dsh-workspace";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceBroadcaster } from "../workspace-broadcaster.service.ts";
import { WorkspaceControllerRow } from "../workspace-controller.host.ts";
import { FakeWorkspaceRegistry, workspaceOf } from "./support/fake-workspace-registry.ts";

/** 假 native backend：workspace 行只要求 `ctx.directoryPicker` 有实现可读。 */
@Injectable()
class FakeNativePicker extends DirectoryPickerBackend {
  capability(): DirectoryPickerCapability {
    return { kind: "native", pick: async (): Promise<null> => null };
  }
}

interface AppHandles {
  handlers: RemoteHandlers;
  registry: FakeWorkspaceRegistry;
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
}

const opened: AppHandles[] = [];

afterEach(async () => {
  for (const handle of opened.splice(0)) await handle.app.dispose().catch(() => {});
}, 10_000);

async function boot(rows: string[]): Promise<AppHandles> {
  const app = await bootstrapApplication({
    providers: [...provideTypert(), ...provideRemoteAccess(),
    
      RemoteHandlersDefault,
      FakeWorkspaceRegistry,
      WorkspaceBroadcaster,
      FakeNativePicker,
      WorkspaceControllerRow,
    ],
    timeoutMs: 10_000,
  });
  const registry = app.get(FakeWorkspaceRegistry);
  for (const path of rows) registry.rows.push(workspaceOf(path));
  const handle = { handlers: app.get(RemoteHandlers), registry, app };
  opened.push(handle);
  return handle;
}

describe("host 侧 workspace 面", { timeout: 15_000 }, () => {
  it("workspace/follow 的首帧是 registry 的 baseline", async () => {
    const { handlers } = await boot(["/tmp/a", "/tmp/b"]);
    const controller = new AbortController();
    const source = handlers.stream("workspace/follow", {}, controller.signal);
    expect(source, "registerStream 应已注册 workspace/follow").toBeDefined();
    const iterator = (source as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const first = (await iterator.next()) as {
      value?: { type?: string; value?: { items?: { path: string }[] } };
    };
    controller.abort();
    try {
      await iterator.return?.(undefined);
    } catch {
      // 取消后生成器的收尾错误不是本用例的断言对象。
    }
    expect(first.value?.type).toBe("baseline");
    expect(first.value?.value?.items?.map((item) => item.path)).toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("workspace/create 落到 registry 上并回 WorkspaceValue", async () => {
    const { handlers, registry } = await boot([]);
    // unary 结果按上游 wire 包成 `RemoteResult`（客户端 `ClientWorkspaceModel` 按 `result.ok` 解）。
    const result = (await handlers.invoke("workspace/create", {
      request: { path: "/tmp/new" },
    })) as {
      ok?: boolean;
      value?: { created?: boolean; workspace?: { path?: string } };
    };
    expect(result.ok).toBe(true);
    expect(result.value?.created).toBe(true);
    expect(result.value?.workspace?.path).toBe("/tmp/new");
    expect(registry.rows.map((row) => row.path)).toEqual(["/tmp/new"]);
  });

  it("create 之后，活跃的 follow 流收到 upsert 帧（列表才会出现新工作区）", async () => {
    const { handlers } = await boot([]);
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

    await handlers.invoke("workspace/create", { request: { path: "/tmp/new" } });

    const upsert = (await iterator.next()) as {
      value?: { type?: string; workspace?: { workspaceId?: string; path?: string } };
    };
    expect(upsert.value?.type).toBe("upsert");
    expect(upsert.value?.workspace?.workspaceId).toBe("w-/tmp/new");
    expect(upsert.value?.workspace?.path).toBe("/tmp/new");

    controller.abort();
  });

  it("取消信号让 follow 结束（读完 baseline 后 abort 即收尾）", async () => {
    const { handlers } = await boot(["/tmp/a"]);
    const controller = new AbortController();
    const source = handlers.stream(
      "workspace/follow",
      {},
      controller.signal,
    ) as AsyncIterable<unknown>;
    const iterator = source[Symbol.asyncIterator]();
    const first = (await iterator.next()) as { value?: { type?: string } };
    expect(first.value?.type).toBe("baseline");
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });
});

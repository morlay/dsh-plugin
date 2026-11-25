/**
 * `WorkspaceController` 的**全链路**闭环：视图 → client → wire → host（`WorkspaceControllerRow` → 注册表）。
 *
 * 守三件事：宿主注册表里已有的工作区出现在 client 的列表里（`ui-workspace` 的 `useWorkspaces` 就读它）、
 * `create` 真的落到宿主并回一个 `WorkspaceView`、以及宿主广播的增量让列表跟得上。
 *
 * **只替外部世界**：注册表用 `@morlay/dsh-workspace/testing` 的内存实现（那是存储面，不是传输），
 * 传输是真 `LocalRemote`（`clientWithTransport` 接 host 的执行面）；不替换自己的传输层。
 */
import type { DirectoryPickerCapability } from "@deepseek-ai/dsh-host-directory-picker";
import { Injectable, type App } from "@morlay/zephyr";
import { RemoteHandlers, provideApiGateway, provideRemoteAccess, provideTypert } from "@morlay/zephyr-app";
import { bootTwoSided, clientWithTransport } from "@morlay/zephyr-app/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { DirectoryPickerBackend, WorkspaceRegistry } from "@morlay/dsh-workspace";
import { FakeWorkspaceRegistry, workspaceOf } from "@morlay/dsh-workspace/testing";
import { WorkspaceController } from "../../endpoint/index.ts";
import { WorkspaceBroadcaster } from "../../workspace-broadcaster.service.ts";
import { WorkspaceControllerRow } from "../../server/workspace-controller.host.ts";
import { WorkspaceControllerDefault } from "../workspace-controller.service.ts";
import { WorkspaceEndpointClient } from "../workspace-endpoint.client.ts";

/** 假 native backend：workspace 行只要求 `ctx.directoryPicker` 有实现可读。 */
@Injectable()
class FakeNativePicker extends DirectoryPickerBackend {
  capability(): DirectoryPickerCapability {
    return { kind: "native", pick: async (): Promise<null> => null };
  }
}

/**
 * 起一双端：host = 真 `WorkspaceControllerRow` + 内存注册表，client = 契约的客户端形态 + `WorkspaceControllerDefault`。
 * @param seed - client 连上**之前**要塞进宿主注册表的路径（follow 的 baseline 就是它们）。
 * @returns client app 与它的 `WorkspaceController` 契约。
 */
async function boot(seed: readonly string[] = []): Promise<{
  app: App;
  workspaces: WorkspaceController;
}> {
  const two = await bootTwoSided({
    createHost: () => [
      ...provideTypert(),
      // `typertGateway` 的实现是上游 `api/gateway` 的 `TypertGatewayService`（我们不再自己写）。
      ...provideApiGateway(),
      ...provideRemoteAccess(),
      FakeWorkspaceRegistry,
      WorkspaceBroadcaster,
      FakeNativePicker,
      WorkspaceControllerRow,
    ],
    createClient: (host) => {
      // 播种在 client 起来之前：`workspace/follow` 的首帧 baseline 就是注册表的当前全量。
      const registry = host.get(WorkspaceRegistry) as FakeWorkspaceRegistry;
      for (const path of seed) registry.rows.push(workspaceOf(path));
      return clientWithTransport(host, [WorkspaceEndpointClient, WorkspaceControllerDefault]);
    },
  });
  if (two.client === undefined) throw new Error("client 没装上");
  expect(two.host.get(RemoteHandlers), "宿主没有端点执行面就跑不了链路").toBeDefined();
  return { app: two.client, workspaces: two.client.get(WorkspaceController) };
}

/** 等 store 满足条件（follow 是异步接上的，别用固定时长猜）。 */
async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("WorkspaceController", { timeout: 20_000 }, () => {
  test("宿主注册表里已有的工作区经 baseline 进 client 的列表（items / phase）", async () => {
    const { workspaces } = await boot(["/tmp/w"]);
    await until(() => workspaces.list.getSnapshot().items.length > 0);
    expect(workspaces.list.getSnapshot().items.map((item) => item.path)).toEqual(["/tmp/w"]);
    expect(workspaces.list.getSnapshot().phase).toBe("ready");
  });

  test("create 走 workspace/create 落到宿主注册表，并回一个 WorkspaceView", async () => {
    const { workspaces } = await boot();
    await until(() => workspaces.list.getSnapshot().phase === "ready");
    const created = await workspaces.create({ path: "/tmp/w3" });
    expect(created, "create 的返回值就是宿主给的那一行").toMatchObject({ path: "/tmp/w3" });
    // 宿主广播的 upsert 帧让列表跟上（不重拉目录）。
    await until(() => workspaces.list.getSnapshot().items.some((item) => item.path === "/tmp/w3"));
    expect(workspaces.list.getSnapshot().items.map((item) => item.path)).toContain("/tmp/w3");
  });
});

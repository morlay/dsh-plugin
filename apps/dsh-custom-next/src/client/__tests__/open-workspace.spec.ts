// @vitest-environment happy-dom
/**
 * **选中工作区 → 建出会话 → 主视图拿到 binding**（真前后端，真 wire）。
 *
 * 这条钉的是用户实际走的那条路：在 hero 里选一个工作区。链路的每一跳都曾被静默掉过：
 *   `selectWorkspace` → `openWorkspace` → `connectBlank` → `sessions.create`（占位行）
 *     → `retain(…, { source: 'mainView' })` → 主区渲染输入条
 * 任何一跳静默，表现都是"选了工作区，界面什么都不变"，而且控制台不报错。
 */
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { clientPackagesOf, WebServer } from "@morlay/zephyr-app";
import { ClientConnectionDefault } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-session/ui";
import { UiWorkspace, WorkspaceController } from "@morlay/dsh-workspace/ui";
import { afterEach, describe, expect, it } from "vitest";
import { appClientProviders } from "../index.ts";
import { customProvidersOf } from "../../zephyr.provide.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0).reverse()) {
    await Promise.race([
      app.dispose().catch(() => {}),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10_000);
      }),
    ]);
  }
}, 120_000);

/** 起一对真前后端（随机端口，后端真 listen）。 */
async function bootBoth(): Promise<{ frontend: App }> {
  process.env.PORT = "0";
  const rows = [...new Set(await clientPackagesOf(customProvidersOf([])))];
  const backend = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 90_000 });
  opened.push(backend);
  const port = (backend.get(WebServer) as { port?: number }).port;
  expect(port, "后端必须真的 listen 了").toBeGreaterThan(0);
  const frontend = await bootstrapApplication({
    providers: [
      ...appClientProviders(configure(ClientConnectionDefault, { origin: `http://127.0.0.1:${port}` })),
    ],
    timeoutMs: 90_000,
  });
  opened.push(frontend);
  return { frontend };
}

/** 等工作区目录就绪（`workspace/follow` 的首帧 baseline）。 */
async function waitWorkspaces(frontend: App): Promise<{ workspaceId: string }[]> {
  const workspaces = frontend.get(WorkspaceController) as unknown as {
    list: { getSnapshot(): { items: readonly { workspaceId: string }[] } };
  };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const items = workspaces.list.getSnapshot().items;
    if (items.length > 0) return items.map((item) => ({ workspaceId: item.workspaceId }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [];
}

describe("选中工作区", { timeout: 240_000 }, () => {
  it("选中后会话进目录，且主视图拿到 binding（`retainedBy.mainView > 0`）", async () => {
    const { frontend } = await bootBoth();
    const items = await waitWorkspaces(frontend);
    expect(items.length, "要先有工作区可选").toBeGreaterThan(0);

    const sessions = frontend.get(SessionController) as unknown as {
      list: { getSnapshot(): { ids: readonly string[]; byId: Readonly<Record<string, { retainedBy?: Readonly<Record<string, number>> }>> } };
      retainInfo(id: string): { getSnapshot(): { retainedBy: Readonly<Record<string, number>> } };
    };
    const uiWorkspace = frontend.get(UiWorkspace) as unknown as {
      openWorkspace(id: string): Promise<void>;
    };

    // 走用户点选工作区时调的那条路。
    await expect(uiWorkspace.openWorkspace(items[0]!.workspaceId)).resolves.toBeUndefined();

    const snapshot = sessions.list.getSnapshot();
    expect(snapshot.ids.length, "选中工作区后目录里必须有会话").toBeGreaterThan(0);
    // 主视图那一条：`openWorkspace` 会 `retain(id, { source: 'mainView' })`。
    const mainView = snapshot.ids
      .map((id) => ({ id, retainedBy: sessions.retainInfo(id).getSnapshot().retainedBy }))
      .filter((row) => (row.retainedBy["mainView"] ?? 0) > 0);
    expect(mainView.length, "主视图必须拿到 binding（否则界面停在 hero）").toBeGreaterThan(0);
  });

  it("选中工作区后模型投影读得到（输入条据此可用，不再停在加载）", { timeout: 240_000 }, async () => {
    const { frontend } = await bootBoth();
    const items = await waitWorkspaces(frontend);
    expect(items.length, "要先有工作区可选").toBeGreaterThan(0);

    const uiWorkspace = frontend.get(UiWorkspace) as unknown as {
      openWorkspace(id: string): Promise<void>;
    };
    await expect(uiWorkspace.openWorkspace(items[0]!.workspaceId)).resolves.toBeUndefined();

    const sessions = frontend.get(SessionController) as unknown as {
      list: { getSnapshot(): { ids: readonly string[] } };
      retainInfo(id: string): { getSnapshot(): { retainedBy: Readonly<Record<string, number>> } };
      binding(id: string):
        | { session?: { projections: { faceOf(key: string): { getSnapshot(): unknown } } } }
        | undefined;
    };
    // 主视图 retain 的那个会话就是界面正在用的那个。
    const id = sessions.list.getSnapshot().ids.find(
      (candidate) => (sessions.retainInfo(candidate).getSnapshot().retainedBy["mainView"] ?? 0) > 0,
    );
    expect(id, "主视图那个会话").toBeDefined();

    // 上游模型选择器（`ModelDirectory`）读的就是这一面：`undefined` 会让它永远停在 loading。
    const face = sessions.binding(id as string)?.session?.projections.faceOf("modelSelection");
    expect(face, "binding 必须带投影读面").toBeDefined();
    // 宿主算出来的投影经 `session/control` 基线异步到达：等它，不用固定时长猜。
    for (let attempt = 0; attempt < 60 && face?.getSnapshot() === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(face?.getSnapshot(), "模型投影必须有值（否则输入条永远停在「正在加载模型…」）").toBeDefined();
  });
});

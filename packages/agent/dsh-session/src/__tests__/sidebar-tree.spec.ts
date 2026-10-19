// 侧栏会话树的**数据判据**：一条有内容的会话，必须能被上游的树构建函数列出来。
//
// 为什么值得单独测：侧栏"没有会话行"有两种完全不同的原因——
//   1. 数据不对（`session/list` 的 `blank` 判错、`byId` 缺行）；
//   2. 本来就没有可显示的东西（磁盘上全是空白会话，上游按设计只显示当前那条空白）。
// 这两者表现一样、修法相反，所以这里把判据写成：**有 `turn/start` 的会话 → `blank:false` → 出现在树里**。
//
// 不断言 React：树构建是上游的纯函数（`deriveGroups`），宿主行是我们自己的（`snapshotForRemote`）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideAgent } from "@morlay/dsh-agent/server";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { deriveGroups } from "@deepseek-ai/dsh-client-ui-workspace/src/client/tree.ts";
import { provideSessionsHost } from "../server/sessions-host.provide.ts";
import { SessionControllerHost } from "../server/session-controller.host.ts";
import { provideWorkspace } from "@morlay/dsh-workspace/server";
import { provideStorage } from "@morlay/dsh-storage";
import { provideSessionPersistence } from "@morlay/dsh-session-persistence";
import { providePersistence } from "@morlay/dsh-persistence";

const opened: App[] = [];
const roots: string[] = [];

/** 只给数据根的运行环境（会话落在 `<dataDir>/sessions/`）。 */
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues;

  readonly cacheDir: string;

  readonly packageRoot: string;

  readonly appBootDir: string;

  readonly profileManifest: string;

  constructor(root: string) {
    super();
    this.values = { dataDir: root, profileDir: root, dev: true } as AppEnvValues;
    this.cacheDir = join(root, "cache");
    this.packageRoot = root;
    this.appBootDir = join(root, "boot");
    this.profileManifest = join(root, "package.json");
  }
}

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** 一条会话在盘上的最小形态：`meta.json` + `events.jsonl`。 */
async function writeSession(root: string, id: string, events: readonly unknown[]): Promise<void> {
  const dir = join(root, "sessions", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ header: { version: 1, id, createdAt: Date.now(), isSeeded: false, cwd: root }, revision: 1 }),
    "utf8",
  );
  await writeFile(join(dir, "events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
}

/**
 * 起宿主：真持久化（临时目录）+ 会话目录端点。
 * @param root - 数据根。
 * @returns app。
 */
async function boot(root: string): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      { provide: AppEnv, useFactory: () => new FakeAppEnv(root) },
      ...provideAgent(),
      ...provideSessionProjection(),
      // 会话行要 workspace：`SessionWorkspace` 由 workspace 行提供（cwd → 工作区的解析与 attach）。
      ...provideStorage(),
      // json 后端：`workspace-registry` 等域行按名字要它。
      ...providePersistence(),
      ...provideSessionPersistence(),
      ...provideWorkspace(),
      ...provideSessionsHost(),
      RemoteHandlersDefault,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

/** `session/list` 的 wire 值。 */
interface ListValue {
  readonly ids: readonly string[];
  readonly byId: Record<string, { id: string; title?: string; blank?: boolean; updatedAt?: number; cwd?: string }>;
}

describe("侧栏会话树的数据判据", () => {
  it("有 `turn/start` 的会话不是 blank，且会出现在工作区的分组里", { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-sidebar-tree-"));
    roots.push(root);
    // 一条有内容的会话 + 一条只有 seed 的空白会话：上游只隐藏后者。
    await writeSession(root, "s-engaged", [
      { type: "session/end-seed", seq: 0, time: 1, data: {} },
      { type: "turn/start", seq: 1, time: 2, data: {} },
    ]);
    await writeSession(root, "s-blank", [{ type: "session/end-seed", seq: 0, time: 1, data: {} }]);

    const app = await boot(root);
    // 直接读宿主目录面（`session/list` 的 wire 行还要 typert / attachment 等半打依赖，与本判据无关）。
    const listed = (await app.get(SessionControllerHost).snapshotForRemote()) as unknown as ListValue;

    expect(Object.keys(listed.byId).sort()).toEqual(["s-blank", "s-engaged"]);
    expect(listed.byId["s-engaged"]?.blank, "有 turn/start 的会话必须是非 blank").toBe(false);
    expect(listed.byId["s-blank"]?.blank, "只有 seed 的会话是 blank").toBe(true);

    // 上游的树构建：工作区声明了这两条会话，非 blank 的那条必须列出来。
    const groups = deriveGroups(
      { ids: [...listed.ids], byId: listed.byId, phase: "ready", projectionsBySession: {} } as never,
      [
        {
          workspaceId: "w1",
          path: root,
          title: "dsh-plugin",
          sessionIds: ["s-engaged", "s-blank"],
          createdAt: new Date(1).toISOString(),
          updatedAt: new Date(2).toISOString(),
        } as never,
      ],
      // `SessionRowState`：没有归档/置顶，默认过滤。
      { archivedSessionIds: [], pinnedSessionIds: [], archivedFilter: "default" } as never,
      new Map() as never,
      // `TreeView`：全展开、无 ungrouped 手排。
      { expandedGroups: ["w1"], ungroupedOrder: [] } as never,
    );
    const members = groups.flatMap((group) => group.sessions.map((session) => session.id));
    expect(members, "有内容的会话必须出现在侧栏树里").toContain("s-engaged");
    expect(members, "空白会话默认不显示（除非它是当前那条）").not.toContain("s-blank");
    // 顺带咬住 attach：会话按 cwd 归到工作区，前端才有可点的行。
    expect(listed.byId["s-engaged"]?.cwd).toBe(root);
    void SessionId;
    void RemoteHandlersDefault;
  });
});

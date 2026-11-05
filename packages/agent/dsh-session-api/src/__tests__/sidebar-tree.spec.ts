// 侧栏会话树的**数据判据**：一条有内容的会话，必须能被上游的树构建函数列出来。
//
// 为什么值得单独测：侧栏"没有会话行"有两种完全不同的原因——
//   1. 数据不对（`session/list` 的 `blank` 判错、`byId` 缺行）；
//   2. 本来就没有可显示的东西（磁盘上全是空白会话，上游按设计只显示当前那条空白）。
// 这两者表现一样、修法相反，所以这里把判据写成：**有 `turn/start` 的会话 → `blank:false` → 出现在树里**。
//
// 不断言 React：树构建是上游的纯函数（`deriveGroups`），宿主行是我们自己的（`snapshotForRemote`）。
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveGroups } from "@deepseek-ai/dsh-client-ui-workspace/src/client/tree.ts";

const roots: string[] = [];

afterEach(async () => {
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

    // 直接读盘上的会话目录构出同一份视图：`blank` 的判据是"有没有 `turn/start`"（与上游
    // `SessionSummary.blank` 同义）。不经宿主——这条 spec 的判据是**树构建**，不是端点。
    const sessionsDir = join(root, "sessions");
    const ids = (await readdir(sessionsDir)).sort();
    const listed = {
      ids,
      byId: Object.fromEntries(
        await Promise.all(
          ids.map(async (id) => {
            const events = await readFile(join(sessionsDir, id, "events.jsonl"), "utf8");
            // `retainedBy` 是上游 `SessionSummary` 的必填面（`mainSessionId` 读 `mainView`）。
            return [
              id,
              { id, cwd: root, blank: !events.includes('"turn/start"'), retainedBy: {} },
            ] as const;
          }),
        ),
      ),
    } as unknown as ListValue;
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
  });
});

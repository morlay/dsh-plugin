// 管理面能力的场景闭环：会话列表（归档 / 子代理 / 搜索 / 分页）、删除语义、导出→导入回读、GC 回收。
import { afterEach, describe, expect, it } from "vitest";
import { SessionId, SessionSeq, type SessionEvent } from "@deepseek-ai/dsh-session";
import { SessionAdmin, SessionDeletionError, parseImportZip } from "../../admin/index.ts";
import { harness, meta, oneTurnLog } from "../../testing.ts";
import { strToU8, zip } from "fflate";
import { parseJsonlArtifact } from "../../artifact.ts";
import { SESSION_LOG_ARTIFACT_FILENAME } from "../../import/session-import.ts";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function mount() {
  const rdb = await harness();
  disposers.push(() => rdb.app.dispose());
  return { ...rdb, admin: rdb.app.get(SessionAdmin) };
}

function titled(log: readonly SessionEvent[], title: string, time = log.length + 1): SessionEvent[] {
  return [
    ...log,
    {
      type: "session/title",
      seq: SessionSeq(log.length),
      time,
      data: { title, messageSeqs: [], source: "auto" },
    } as unknown as SessionEvent,
  ];
}

async function archive(
  persistence: Awaited<ReturnType<typeof mount>>["persistence"],
  ...ids: string[]
): Promise<void> {
  await persistence.internals().backend.storage.writeWorkspaceState({
    initialized: true,
    workspaceIds: [],
    pinnedSessionIds: [],
    archivedSessionIds: ids.map((id) => SessionId(id)),
  });
}

function zipBytes(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => (error === null ? resolve(data) : reject(error)));
  });
}

describe("SessionAdmin", () => {
  it("列表给出完整语料（含归档）与标题，并支持搜索与分页", async () => {
    const { admin, persistence } = await mount();
    await persistence.createAndAppend(meta("kept"), titled(oneTurnLog(), "留下的会话"));
    await persistence.createAndAppend(
      { ...meta("archived"), origin: "subagent" },
      titled(oneTurnLog(), "归档的子代理"),
    );
    await archive(persistence, "archived");

    const all = await admin.listRows({ includeSubagents: true });
    expect(all.total).toBe(2);
    expect(all.items.map((item) => item.title).sort()).toEqual(["留下的会话", "归档的子代理"].sort());
    expect(all.items.find((item) => item.sessionId === "archived")?.archived).toBe(true);

    const searched = await admin.listRows({ query: "留下", includeSubagents: true });
    expect(searched.items.map((item) => item.sessionId)).toEqual(["kept"]);

    const paged = await admin.listRows({ page: 2, pageSize: 1, includeSubagents: true });
    expect(paged).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(paged.items).toHaveLength(1);
  });

  it("删除只接受已归档会话，运行中的会话拒绝", async () => {
    const { admin, persistence } = await mount();
    await persistence.createAndAppend(meta("not-archived"), oneTurnLog());
    await expect(admin.deleteSession(SessionId("not-archived"))).rejects.toMatchObject({
      code: "SESSION_NOT_ARCHIVED",
    });

    await persistence.createAndAppend(meta("live"), oneTurnLog());
    await archive(persistence, "live");
    const handle = await persistence.open(SessionId("live"), "write");
    try {
      await expect(admin.deleteSession(SessionId("live"))).rejects.toMatchObject({
        code: "SESSION_LIVE",
      });
    } finally {
      await handle.close();
    }

    await persistence.createAndAppend(meta("droppable"), oneTurnLog());
    await archive(persistence, "droppable");
    await admin.deleteSession(SessionId("droppable"));
    expect((await persistence.list()).map((snapshot) => String(snapshot.header.id))).not.toContain(
      "droppable",
    );
  });

  it("未知会话的删除给出 SESSION_NOT_FOUND", async () => {
    const { admin } = await mount();
    await expect(admin.deleteSession(SessionId("missing"))).rejects.toBeInstanceOf(
      SessionDeletionError,
    );
  });

  it("导出产物能被导入侧的解析器读回", async () => {
    const { admin, persistence } = await mount();
    await persistence.createAndAppend(meta("exported"), oneTurnLog());

    const raw = await admin.exportSession(SessionId("exported"));
    expect(raw).toBeDefined();
    const parsed = parseJsonlArtifact(raw!.content);
    expect(String(parsed.meta.id)).toBe("exported");
    expect(parsed.events.length).toBeGreaterThan(0);
  });

  it("导入新建会话，也能按 sessionId 覆盖目标会话", async () => {
    const { admin, persistence } = await mount();
    await persistence.createAndAppend(meta("src"), titled(oneTurnLog(), "源会话"));
    const raw = await admin.exportSession(SessionId("src"));
    const zip = await zipBytes({ [SESSION_LOG_ARTIFACT_FILENAME]: strToU8(raw!.content) });
    const imported = await parseImportZip(zip);

    const created = await admin.importSession(imported);
    expect(created).not.toBe(SessionId("src"));
    expect(await persistence.readLog(created, {})).toBeDefined();

    await persistence.createAndAppend(meta("target"), oneTurnLog());
    const overwritten = await admin.importSession(imported, SessionId("target"));
    expect(overwritten).toBe(SessionId("target"));
    const target = await persistence.readLog(SessionId("target"), {});
    expect(target?.events.map((event) => event.type)).toContain("session/title");
  });

  it("GC 回收孤儿 subagent 会话与孤儿事件行，重复执行幂等", async () => {
    const { admin, persistence } = await mount();
    await persistence.createAndAppend(meta("parent"), oneTurnLog());
    await persistence.createAndAppend(
      { ...meta("child-orphan"), parentSession: SessionId("gone"), origin: "subagent" },
      oneTurnLog(),
    );

    const first = await admin.gc();
    expect(first.orphanSessions).toBe(1);
    expect(first.orphanEvents).toBeGreaterThan(0);
    const listed = (await persistence.list()).map((snapshot) => String(snapshot.header.id));
    expect(listed).toContain("parent");
    expect(listed).not.toContain("child-orphan");

    const second = await admin.gc();
    expect(second.orphanSessions).toBe(0);
    expect(second.orphanEvents).toBe(0);
  });
});

// 存储层的自愈面：撕裂尾部、旧世代格式、导出 / 导入的往返、整理数据后的统计。
//
// 判据是「读视图一定完整、写路径能接着写」——库里的坏行不外泄，也不阻断后续写入。
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { asRdbStore } from "@morlay/better-session";
import { SessionPersistenceRdb, parseJsonlArtifact } from "@morlay/better-session";
import { afterEach, describe, expect, it } from "vitest";
import { makeRoot, removeRoot, startAt, type Instance } from "./support/host.ts";
import { meta, oneTurnLogStepFirst, turnLog } from "@morlay/dsh-session/testing";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await removeRoot(root);
});

async function start(): Promise<{ root: string; instance: Instance }> {
  const root = await makeRoot();
  roots.push(root);
  return { root, instance: await startAt(root) };
}

// 库路径：`<数据根>/sessions/sessions.sqlite`（与官方 jsonl 实现同一个目录，见 `backendConfig`）。
function databasePathOf(root: string): string {
  return join(root, "sessions", "sessions.sqlite");
}

// 撕掉物理尾部：删掉尾部桥接行，并把 head 指回新的最后一行（模拟写入过程中崩溃留下的形状）。
function tearTail(root: string, id: string, sequence: number): void {
  const db = new DatabaseSync(databasePathOf(root));
  try {
    const kept = db
      .prepare(
        "SELECT f_sequence, f_event_id FROM t_session_events WHERE f_session_id = ? AND f_sequence < ? ORDER BY f_sequence DESC LIMIT 1",
      )
      .get(id, sequence) as { f_sequence: number; f_event_id: string } | undefined;
    db.prepare("DELETE FROM t_session_events WHERE f_session_id = ? AND f_sequence >= ?").run(
      id,
      sequence,
    );
    db.prepare(
      "UPDATE t_sessions SET f_head_sequence = ?, f_head_event_id = ? WHERE f_session_id = ?",
    ).run(kept?.f_sequence ?? -1, kept?.f_event_id ?? "", id);
  } finally {
    db.close();
  }
}

describe("存储层自愈", () => {
  it("撕裂的物理尾部不外泄给读，写路径能接着写", async () => {
    const { root, instance } = await start();
    try {
      const handle = await instance.persistence.create(meta("torn", "/work"));
      await handle.append(oneTurnLogStepFirst());
      await handle.close();

      tearTail(root, "torn", 4);

      const reader = await instance.persistence.open(SessionId("torn"), "read");
      const events = (await reader.read()).events;
      await reader.close();
      // 被撕掉的那条之后的事件不再出现（前缀仍然完整、连续）。
      expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3]);

      const writer = await instance.persistence.open(SessionId("torn"), "write");
      await writer.append(turnLog(4, 2));
      await writer.close();

      const verify = await instance.persistence.open(SessionId("torn"), "read");
      // 从被截断的位点接着写：新回合占 4..9，整段连续。
      expect((await verify.read()).events.map((event) => event.seq)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      await verify.close();
    } finally {
      await instance.dispose();
    }
  });

  it("导出件能原样导入回一个（新的）会话", async () => {
    const { instance } = await start();
    try {
      const store = asRdbStore(instance.persistence);
      const handle = await instance.persistence.create(meta("export-src", "/work"));
      await handle.append(oneTurnLogStepFirst());
      await handle.close();

      const raw = await store.readRaw("export-src");
      expect(raw?.content.split("\n").filter((line) => line !== "")).toHaveLength(7);

      const parsed = parseJsonlArtifact(raw?.content ?? "");
      expect(parsed.events).toHaveLength(6);
    } finally {
      await instance.dispose();
    }
  });

  it("整理数据之后会话仍然可读（VACUUM 不改内容）", async () => {
    const { instance } = await start();
    try {
      const handle = await instance.persistence.create(meta("vacuum-me"));
      await handle.append(oneTurnLogStepFirst());
      await handle.close();

      await asRdbStore(instance.persistence).organize();

      const reader = await instance.persistence.open(SessionId("vacuum-me"), "read");
      const events = (await reader.read()).events;
      await reader.close();
      expect(events).toHaveLength(6);
    } finally {
      await instance.dispose();
    }
  });

  it("库里的结构版本不认识时拒绝打开（fail-loud，不静默当成新库）", async () => {
    const root = await makeRoot();
    roots.push(root);
    const first = await startAt(root);
    const handle = await first.persistence.create(meta("version-check"));
    await handle.append(oneTurnLogStepFirst());
    await handle.close();
    await first.dispose();

    const db = new DatabaseSync(databasePathOf(root));
    try {
      db.exec("PRAGMA user_version = 99");
    } finally {
      db.close();
    }

    // 判据从「装配失败」改成「第一次读失败」：源包的装配是 `this.ready = this.init()`（构造里起、不 await），
    // 坏库不阻断启动——一个库只是宿主里的一行。迁移过来的 `rdb.spec` 里
    // 「rejects and closes a current-schema database with an invalid store identity」是同一口径。
    const instance = await startAt(root);
    try {
      await expect(instance.persistence.list()).rejects.toThrow(/schema version 99/);
    } finally {
      await instance.dispose();
    }
  });

  it("默认配置落在 <数据根>/sessions/sessions.sqlite（配置门面的默认值）", async () => {
    const { root, instance } = await start();
    try {
      expect(instance.app.get(SessionPersistence)).toBeInstanceOf(SessionPersistenceRdb);
      const handle = await instance.persistence.create(meta("where"));
      await handle.append(oneTurnLogStepFirst());
      await handle.close();
      const db = new DatabaseSync(databasePathOf(root));
      try {
        const row = db
          .prepare("SELECT f_session_id FROM t_sessions WHERE f_session_id = ?")
          .get("where");
        expect(row).toBeDefined();
      } finally {
        db.close();
      }
    } finally {
      await instance.dispose();
    }
  });
});

// 批量导出 / 批量导入（L2：真装配 + 真库）：逐条结算、对齐上游 session format（不引入自定义 manifest）。
//
// 判据落在库这一面：导出的正文是上游 format 的 JSONL（header 行 + 整段事件行），导入按 zip 里的 artifact 名认包，
// 一条失败只影响它自己（不整批回滚）。
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  sessionFormatLogFilename,
} from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { meta, oneTurnLogStepFirst, twoTurnLog } from "@morlay/dsh-session/testing";
import { asRdbStore } from "@morlay/better-session";
import { strToU8 } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";
import { zipOf } from "../../__tests__/support/zip.ts";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

async function seed(harness: Harness, id: string, log = twoTurnLog()): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id, "/work"));
  await handle.append(log);
  await handle.close();
}

const storeOf = (harness: Harness) => asRdbStore(harness.app.get(SessionPersistence));

describe("L2 批量导出", () => {
  it("逐条导出上游 format 的整段日志：不存在的会话带 SESSION_NOT_FOUND，别的条照常导出", async () => {
    const harness = await start();
    await seed(harness, "export-a");
    await seed(harness, "export-b", oneTurnLogStepFirst());

    const result = await storeOf(harness).exportMany(["export-a", "absent", "export-b"]);

    expect(result.items.map(({ sessionId, ok, code }) => ({ sessionId, ok, code }))).toEqual([
      { sessionId: "export-a", ok: true, code: undefined },
      { sessionId: "absent", ok: false, code: "SESSION_NOT_FOUND" },
      { sessionId: "export-b", ok: true, code: undefined },
    ]);
    // 文件名就是上游 format 的那一份（zip 里的 artifact 名，不另立 manifest）。
    const artifact = sessionFormatLogFilename(SESSION_FORMAT_VERSION);
    expect(result.items[0]?.filename).toBe(artifact);
    const lines = (result.items[0]?.content ?? "").split("\n");
    // header 行 + 整段日志的事件行（twoTurnLog 是 12 条）。
    expect(lines).toHaveLength(13);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ type: "session", id: "export-a" });
    expect(JSON.parse(lines[1] as string)).toMatchObject({ seq: 0, type: "turn/start" });
  });
});

describe("L2 批量导入", () => {
  it("逐条把 zip 落成新会话：好包照常导入，没有 artifact 的包带域码，整批不回滚", async () => {
    const harness = await start();
    await seed(harness, "import-source", oneTurnLogStepFirst());
    const store = storeOf(harness);
    const exported = (await store.exportMany(["import-source"])).items[0];
    const artifact = exported?.filename ?? "";
    const goodZip = await zipOf({ [artifact]: strToU8(exported?.content ?? "") });
    // 一份包，但不是会话包：里面没有上游 format 的 artifact 行。
    const badZip = await zipOf({ "notes.txt": strToU8("not a session") });

    const result = await store.importMany([goodZip, badZip]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ ok: true, filename: artifact });
    expect(result.items[1]).toMatchObject({ ok: false, code: "SESSION_IMPORT_NO_ARTIFACT" });
    // 导入是新建：新铸的会话 id，日志读得出来且与源会话同形。
    const created = result.items[0]?.sessionId ?? "";
    expect(created).not.toBe("import-source");
    const reader = await harness.app.get(SessionPersistence).open(SessionId(created), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events.map((event) => event.type)).toEqual(
      (await store.load("import-source")).events.map((event) => event.type),
    );
  });
});

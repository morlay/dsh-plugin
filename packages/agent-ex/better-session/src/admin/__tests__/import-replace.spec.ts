// D1：覆盖导入是原子的——整段替换后日志与 seed 长度一致；坏包与运行中的会话不动原数据。
//
// 另两条导入后的不变量：`f_seed_length` 收在新 head 之内（未种子的导入件不留旧种子）；导入的会话是
// **根会话**（父引用与子代理标记都不落库），否则悬空的子代理父引用会被 `organize` 当孤儿删掉。
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionId, SessionLogOffset } from "@morlay/dsh-session/contract";
import { asRdbStore } from "@morlay/better-session";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../../__tests__/support/host.ts";
import { meta, oneTurnLogStepFirst, turnLog, twoTurnLog } from "@morlay/dsh-session/testing";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
});

async function start(): Promise<Harness> {
  const harness = await startHarness();
  harnesses.push(harness);
  return harness;
}

async function zipOf(content: string): Promise<Uint8Array> {
  const { zip, strToU8 } = await import("fflate");
  return await new Promise<Uint8Array>((resolve, reject) => {
    zip({ "session.jsonl": strToU8(content) }, (error, data) => {
      if (error === null) resolve(data);
      else reject(error);
    });
  });
}

async function seed(harness: Harness, id: string, rounds = 1): Promise<void> {
  const handle = await harness.app.get(SessionPersistence).create(meta(id));
  await handle.append(oneTurnLogStepFirst());
  if (rounds > 1) await handle.append(turnLog(6, 2));
  await handle.close();
}

describe("导入覆盖（D1）", () => {
  it("整段替换后日志与 seed 长度一致，坏包不动原会话，运行中拒绝覆盖", async () => {
    const harness = await start();
    await seed(harness, "target");
    await seed(harness, "source", 2);
    const store = asRdbStore(harness.app.get(SessionPersistence));

    const exported = await store.readRaw("source");
    expect(exported).toBeDefined();
    const zip = await zipOf(exported!.content);

    // 覆盖导入：目标会话换成 source 的整段日志（12 条）。
    expect(await store.importZip(zip, "target")).toBe("target");
    const replaced = await store.load("target");
    expect(replaced.events).toHaveLength(12);
    // seed 长度必须 ≤ 日志长度：否则读出来 inheritedEventCount 大于日志，整条会话读不出来。
    expect(replaced.inheritedEventCount).toBeLessThanOrEqual(replaced.events.length);

    // 坏包：带码失败，原会话完好。
    await expect(store.importZip(new Uint8Array([1, 2, 3]), "target")).rejects.toMatchObject({
      code: "SESSION_IMPORT_INVALID_PACKAGE",
    });
    expect((await store.load("target")).events).toHaveLength(12);

    // 运行中：拒绝覆盖，原会话完好。
    const writer = await harness.app.get(SessionPersistence).open(SessionId("target"), "write");
    await expect(store.importZip(zip, "target")).rejects.toMatchObject({
      code: "SESSION_IMPORT_LIVE",
    });
    await writer.close();
    expect((await store.load("target")).events).toHaveLength(12);
  });

  it("覆盖导入把 f_seed_length 收到新 head 之内：未种子的导入件不留旧种子", async () => {
    const harness = await start();
    const store = asRdbStore(harness.app.get(SessionPersistence));
    // 目标是一个种子会话：6 条继承前缀 + 两个回合（12 条），于是 f_seed_length = 6。
    const target = await harness.app.get(SessionPersistence).create(
      { ...meta("seeded-target", "/work"), isSeeded: true },
      {
        inheritedEventCount: SessionLogOffset(6),
      },
    );
    await target.append(twoTurnLog());
    await target.close();
    await seed(harness, "plain-source");

    const before = await store.readModel().getSession("seeded-target");
    expect(before?.fSeedLength, "先决条件：目标带 6 条继承前缀").toBe(6);
    // 不变量：种子长度不超过新 head（head + 1 就是日志长度）。
    expect(before!.fSeedLength! <= before!.fHeadSequence + 1).toBe(true);

    const zip = await zipOf((await store.readRaw("plain-source"))!.content);
    await store.importZip(zip, "seeded-target");

    const after = await store.readModel().getSession("seeded-target");
    expect(after?.fHeadSequence, "新 head 是导入件最后一条事件").toBe(5);
    expect(after?.fSeedLength, "未种子的导入件不留旧种子长度").toBeNull();
    expect((await store.load("seeded-target")).inheritedEventCount).toBe(0);
  });

  it("子代理会话导入后是根会话：父引用与子代理标记都不落库，organize 不会当孤儿删掉它", async () => {
    // 源库只用来造导入件：导入只带一条会话，父会话天然不在目标库里。
    const sourceHarness = await start();
    const sourceStore = asRdbStore(sourceHarness.app.get(SessionPersistence));
    const source = await sourceHarness.app.get(SessionPersistence).create({
      ...meta("subagent-child", "/work"),
      parentSession: SessionId("absent-parent"),
      origin: "subagent",
      delegationDepth: 1,
    });
    await source.append(oneTurnLogStepFirst());
    await source.close();
    const exported = await sourceStore.readRaw("subagent-child");
    expect(
      (await sourceStore.headerOf("subagent-child"))?.header.origin,
      "先决条件：导入件带子代理标记",
    ).toBe("subagent");
    const zip = await zipOf(exported!.content);

    const target = await start();
    const store = asRdbStore(target.app.get(SessionPersistence));
    const imported = await store.importZip(zip);

    const header = await store.headerOf(imported);
    expect(header?.header.parentSession, "导入不携带父引用").toBeUndefined();
    expect(header?.header.origin, "子代理标记随父引用一起丢掉").toBeUndefined();

    // 父引用悬空的子代理会话正是孤儿判据：整理之后它仍然在库里、读得出来。
    expect((await store.organize()).orphanSessions).toBe(0);
    expect((await store.load(imported)).events).toHaveLength(6);
  });

  it("同一份 zip 重复新建导入产生两个独立会话（不复用 id、不留幽灵）", async () => {
    const harness = await start();
    await seed(harness, "source", 2);
    const store = asRdbStore(harness.app.get(SessionPersistence));
    const exported = await store.readRaw("source");
    const zip = await zipOf(exported!.content);

    const first = await store.importZip(zip);
    const second = await store.importZip(zip);
    expect(second).not.toBe(first);
    const page = await store.listRows({});
    expect(page.total).toBe(3);
  });
});

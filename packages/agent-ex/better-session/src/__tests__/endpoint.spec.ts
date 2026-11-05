// 两组 remote 端点的行为：注册到 wire 后按 `<组>/<方法>` 调得通，请求/响应形状与契约一致。
//
// 判据是 wire 面（`RemoteHandlers.invoke` 的入参与返回值），不直测内部方法。
import { SessionId, type SessionEvent } from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { RemoteHandlers } from "@morlay/zephyr-app";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness } from "./support/host.ts";
import { meta, oneTurnLog, oneTurnLogStepFirst, twoTurnLog } from "@morlay/dsh-session/testing";

interface Wired {
  readonly handlers: RemoteHandlers;
  readonly persistence: SessionPersistence;
  dispose(): Promise<void>;
}

const wired: Wired[] = [];

afterEach(async () => {
  for (const entry of wired.splice(0)) await entry.dispose();
});

// 清单与装配都在 `support/host.ts`（整包的宿主半）：端点行已并入 `provideBetterSession()`。
async function start(): Promise<Wired> {
  const harness = await startHarness();
  const entry: Wired = {
    handlers: harness.app.get(RemoteHandlers),
    persistence: harness.app.get(SessionPersistence),
    dispose: () => harness.dispose(),
  };
  wired.push(entry);
  return entry;
}

// wire 的 unary 结果：`{ ok: true, value }` 或 `{ ok: false, error }`。
function valueOf<T>(result: unknown): T {
  const shaped = result as RemoteResultWire<T>;
  if (!shaped.ok) throw new Error(`端点失败：${shaped.error.code} ${shaped.error.message}`);
  return shaped.value;
}

function errorCodeOf(result: unknown): string | undefined {
  const shaped = result as RemoteResultWire<unknown>;
  return shaped.ok ? undefined : shaped.error.code;
}

async function seed(entry: Wired, id: string, log = twoTurnLog()): Promise<void> {
  const handle = await entry.persistence.create(meta(id, "/work"));
  await handle.append(log);
  await handle.close();
}

// 「没有 agent 目录」那条退化路径现在要先过「能不能重放」的模型配置检查（装配里已有目录行，
// 见 `SessionAgentControlDefault`）：给种子补一条请求头，判据才仍然落在「只重写日志」上。
function withModelConfig(log: readonly SessionEvent[]): SessionEvent[] {
  return [
    ...log,
    {
      type: "request/header",
      seq: log.length,
      time: log.length,
      data: { header: { config: { provider: "mock", model: "mock" } }, reason: "initial" },
    } as unknown as SessionEvent,
  ];
}

describe("sessionEditor 组", () => {
  it("edit 把日志截到目标回合之前，改过的正文交给重放（装配里没有 agent 时排队 0 条）", async () => {
    const entry = await start();
    await seed(entry, "edit-target", withModelConfig(twoTurnLog()));

    const result = await entry.handlers.invoke("sessionEditor/edit", {
      request: {
        sessionId: "edit-target",
        eventSeq: 8,
        blockIndex: 0,
        text: "改过的输入",
        cascade: "truncate",
      },
    });

    const value = valueOf<{ sessionId: string; queuedTurns: number }>(result);
    expect(value.sessionId).toBe("edit-target");
    // 没有 agent 目录：只截断日志，不重放（编辑的正文落库依赖 agent 重放，与源包同）。
    expect(value.queuedTurns).toBe(0);

    const reader = await entry.persistence.open(SessionId("edit-target"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    // 保留到第一个回合的 turn/end：第二个回合（含刚被编辑的那条）整体被截掉。
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("rewind 截断到指定边界，响应里没有排队条数", async () => {
    const entry = await start();
    await seed(entry, "rewind-target");

    const result = await entry.handlers.invoke("sessionEditor/rewind", {
      request: { sessionId: "rewind-target", toBoundary: 5 },
    });

    expect(valueOf<{ queuedTurns: number }>(result).queuedTurns).toBe(0);
    const reader = await entry.persistence.open(SessionId("rewind-target"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("fork 派生一个新会话，响应里给的是新会话 id", async () => {
    const entry = await start();
    await seed(entry, "fork-target", oneTurnLogStepFirst());

    const result = await entry.handlers.invoke("sessionEditor/fork", {
      request: { sessionId: "fork-target", childSessionId: "fork-child" },
    });

    expect(valueOf<{ sessionId: string }>(result).sessionId).toBe("fork-child");
  });

  it("业务失败包成 `ok: false`，错误码带到 wire 上", async () => {
    const entry = await start();

    const result = await entry.handlers.invoke("sessionEditor/edit", {
      request: {
        sessionId: "absent",
        eventSeq: 2,
        blockIndex: 0,
        text: "x",
        cascade: "truncate",
      },
    });

    expect(errorCodeOf(result)).toBe("gateway/invoke-failed");
  });

  it("recall 撤回一条用户消息（首轮退到 -1，日志清空）", async () => {
    const entry = await start();
    await seed(entry, "recall-target", oneTurnLogStepFirst());

    const result = await entry.handlers.invoke("sessionEditor/recall", {
      request: { sessionId: "recall-target", eventSeq: 2 },
    });

    expect(valueOf<{ sessionId: string }>(result).sessionId).toBe("recall-target");
    const reader = await entry.persistence.open(SessionId("recall-target"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events).toEqual([]);
  });

  it("retry 把该回合的用户输入排进队列（没有 agent 时只重写日志）", async () => {
    const entry = await start();
    await seed(entry, "retry-target", withModelConfig(twoTurnLog()));

    const result = await entry.handlers.invoke("sessionEditor/retry", {
      request: { sessionId: "retry-target", turn: 2, cascade: "truncate" },
    });

    // 没有 agent 目录：只重写日志，队列为 0。
    expect(valueOf<{ queuedTurns: number }>(result).queuedTurns).toBe(0);
  });
});

describe("sessionAdmin 组", () => {
  // 列表按「最近活动」倒序（`f_last_event_at`）：重试只截断 + 重放日志、不改这一列的话，被重试的会话会按
  // **创建时间**沉到列表后面——现场就是「重试过的会话掉进折叠的其余会话里」。
  it("retry 之后被重试的会话在 rows 里排到最前", async () => {
    const entry = await start();
    // older：事件时间 0..5；newer：事件时间 0..11（同一份 `meta.createdAt`，靠最后事件时间分先后）。
    await seed(entry, "row-older", withModelConfig(oneTurnLog()));
    await seed(entry, "row-newer", withModelConfig(twoTurnLog()));

    const orderOf = async (): Promise<string[]> => {
      const value = valueOf<{ items: { sessionId: string }[] }>(
        await entry.handlers.invoke("sessionAdmin/rows", { request: { page: 1, pageSize: 10 } }),
      );
      return value.items.map((item) => item.sessionId);
    };

    expect(await orderOf(), "先决条件：newer 的活动时间更晚").toEqual(["row-newer", "row-older"]);

    await entry.handlers.invoke("sessionEditor/retry", {
      request: { sessionId: "row-older", turn: 1, cascade: "truncate" },
    });

    expect(await orderOf(), "重试是「现在」发生的活动，列表要按它重新排序").toEqual([
      "row-older",
      "row-newer",
    ]);
  });

  it("rows 给出会话行（含标题与归档标记）并按页返回", async () => {
    const entry = await start();
    await seed(entry, "row-1");
    await seed(entry, "row-2", oneTurnLogStepFirst());

    const result = await entry.handlers.invoke("sessionAdmin/rows", {
      request: { page: 1, pageSize: 10 },
    });

    const value = valueOf<{
      items: { sessionId: string }[];
      total: number;
      page: number;
      pageSize: number;
    }>(result);
    expect(value.total).toBe(2);
    expect(value.items.map((item) => item.sessionId).sort()).toEqual(["row-1", "row-2"]);
    expect(value).toMatchObject({ page: 1, pageSize: 10 });
  });

  it("rows 的搜索与子代理过滤在后端做", async () => {
    const entry = await start();
    await seed(entry, "searchable");

    const none = valueOf<{ total: number }>(
      await entry.handlers.invoke("sessionAdmin/rows", { request: { query: "不存在的标题" } }),
    );
    expect(none.total).toBe(0);
  });

  it("usage 回报总量、子代理拆分、按天桶与按会话行（形状与契约一致）", async () => {
    const entry = await start();
    await seed(entry, "usage-1");

    const result = await entry.handlers.invoke("sessionAdmin/usage", { request: { range: "all" } });

    const value = valueOf<{
      totals: { turns: number; totalTokens: number };
      subagent: { turns: number };
      human: { turns: number };
      buckets: readonly unknown[];
      sessions: readonly { sessionId: string }[];
    }>(result);
    // 本次用例的日志没有模型 usage：活动计数按「会话有用量行」的口径过滤，因此全零。
    expect(value.totals).toMatchObject({ turns: 0, totalTokens: 0 });
    expect(value.subagent.turns + value.human.turns).toBe(value.totals.turns);
    expect(Array.isArray(value.buckets)).toBe(true);
    expect(Array.isArray(value.sessions)).toBe(true);
  });

  it("usage 的 range 只影响统计窗口，不影响返回形状", async () => {
    const entry = await start();
    await seed(entry, "usage-range");

    const day = valueOf<{ totals: unknown }>(
      await entry.handlers.invoke("sessionAdmin/usage", { request: { range: "day" } }),
    );
    const all = valueOf<{ totals: unknown }>(
      await entry.handlers.invoke("sessionAdmin/usage", { request: { range: "all" } }),
    );

    expect(day.totals).toBeDefined();
    expect(all.totals).toBeDefined();
  });

  it("export 给 base64 的 zip；import 能把它读回来", async () => {
    const entry = await start();
    await seed(entry, "roundtrip", oneTurnLogStepFirst());

    const exported = valueOf<{ filename: string; zip: string }>(
      await entry.handlers.invoke("sessionAdmin/export", { request: { sessionId: "roundtrip" } }),
    );
    expect(exported.zip.length).toBeGreaterThan(0);

    const imported = valueOf<{ sessionId: string }>(
      await entry.handlers.invoke("sessionAdmin/import", { request: { zip: exported.zip } }),
    );
    const reader = await entry.persistence.open(SessionId(imported.sessionId), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events).toHaveLength(6);
  });

  it("delete 拒绝未归档的会话（码带到 wire 上）", async () => {
    const entry = await start();
    await seed(entry, "not-archived");

    const result = await entry.handlers.invoke("sessionAdmin/delete", {
      request: { sessionId: "not-archived" },
    });

    expect(errorCodeOf(result)).toBe("SESSION_NOT_ARCHIVED");
  });

  it("delete 拒绝不存在的会话", async () => {
    const entry = await start();

    const result = await entry.handlers.invoke("sessionAdmin/delete", {
      request: { sessionId: "absent" },
    });

    expect(errorCodeOf(result)).toBe("SESSION_NOT_FOUND");
  });

  it("organize 停掉运行中的 agent、回收孤儿并重算统计", async () => {
    const entry = await start();
    await seed(entry, "organize-1");

    const result = await entry.handlers.invoke("sessionAdmin/organize", {});

    const value = valueOf<{ stoppedAgents: number; vacuumed: boolean; rebuiltSessions: number }>(
      result,
    );
    expect(value.vacuumed).toBe(true);
    expect(value.stoppedAgents).toBe(0);
    expect(value.rebuiltSessions).toBe(1);
  });
});

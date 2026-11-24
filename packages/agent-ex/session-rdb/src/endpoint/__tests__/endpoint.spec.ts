// 两组 remote 端点的行为：注册到 wire 后按 `<组>/<方法>` 调得通，请求/响应形状与契约一致。
//
// 判据是 wire 面（`RemoteHandlers.invoke` 的入参与返回值），不直测内部方法。
import { join } from "node:path";
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  sessionFormatLogFilename,
  type SessionEvent,
} from "@morlay/dsh-session/contract";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { RemoteHandlers } from "@morlay/zephyr-app";
import type { RemoteResultWire } from "@morlay/zephyr-app/remote";
import { strToU8 } from "fflate";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { startHarness } from "../../__tests__/support/host.ts";
import { openInitializedSqlite } from "../../__tests__/support/sqlite.ts";
import { zipOf } from "../../__tests__/support/zip.ts";
import {
  headerEvent,
  meta,
  oneTurnLog,
  oneTurnLogStepFirst,
  turnLog,
  twoTurnLog,
} from "@morlay/dsh-session/testing";

interface Wired {
  readonly handlers: RemoteHandlers;
  readonly persistence: SessionPersistence;
  readonly root: string;
  dispose(): Promise<void>;
}

// 清单与装配都在 `support/host.ts`（整包的宿主半）：端点行已并入 `provideBetterSession()`。
async function start(): Promise<Wired> {
  const harness = await startHarness();
  const entry: Wired = {
    handlers: harness.app.get(RemoteHandlers),
    persistence: harness.app.get(SessionPersistence),
    root: harness.root,
    dispose: () => harness.dispose(),
  };
  onTestFinished(() => entry.dispose());
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

// 把某个 seq 的事件行写坏：已提交区里的坏行不会被当作撕裂尾部丢掉，这份会话就读不出来了。
async function corruptEvent(entry: Wired, id: string, seq: number): Promise<void> {
  const sqlite = await openInitializedSqlite(
    join(entry.root, "sessions", "sessions.sqlite"),
    "wal",
  );
  try {
    sqlite
      .prepare(
        "UPDATE t_events SET f_data = '{' WHERE f_event_id = " +
          "(SELECT f_event_id FROM t_session_events WHERE f_session_id = ? AND f_sequence = ?)",
      )
      .run(id, seq);
  } finally {
    sqlite.close();
  }
}

// 「没有可用的重放入口」这条路径要先过「能不能重放」的模型配置检查（装配里已有目录行，见
// `SessionAgentControlDefault`）：给种子补一条请求头，判据才落在「没有重放入口」这个码上。
function withModelConfig(log: readonly SessionEvent[]): SessionEvent[] {
  return [...log, headerEvent(log.length)];
}

describe("sessionEditor 组", () => {
  test("没有重放入口时 edit 不截断日志：显式失败带码（不允许「截断了却没写回」）", async () => {
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

    // 改过的正文没有落库路径（会话不在运行中）：整条动作失败，日志保持原样。
    expect(errorCodeOf(result)).toBe("SESSION_EDITOR_REPLAY_UNAVAILABLE");

    const reader = await entry.persistence.open(SessionId("edit-target"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events).toHaveLength(13);
    expect(events.some((event) => event.type === "turn/start" && event.data.turn === 2)).toBe(true);
  });

  test("rewind 截断到指定边界，响应里没有排队条数", async () => {
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

  test("fork 派生一个新会话，响应里给的是新会话 id", async () => {
    const entry = await start();
    await seed(entry, "fork-target", oneTurnLogStepFirst());

    const result = await entry.handlers.invoke("sessionEditor/fork", {
      request: { sessionId: "fork-target", childSessionId: "fork-child" },
    });

    expect(valueOf<{ sessionId: string }>(result).sessionId).toBe("fork-child");
  });

  test("业务失败包成 `ok: false`，错误码带到 wire 上", async () => {
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

  test("recall 撤回一条用户消息（首轮退到 -1，日志清空）", async () => {
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

  test("没有重放入口时 retry 不截断日志：显式失败带码", async () => {
    const entry = await start();
    await seed(entry, "retry-target", withModelConfig(twoTurnLog()));

    const result = await entry.handlers.invoke("sessionEditor/retry", {
      request: { sessionId: "retry-target", turn: 2, cascade: "truncate" },
    });

    expect(errorCodeOf(result)).toBe("SESSION_EDITOR_REPLAY_UNAVAILABLE");

    const reader = await entry.persistence.open(SessionId("retry-target"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events).toHaveLength(13);
  });
});

describe("sessionAdmin 组", () => {
  // 列表按「最近活动」倒序（`f_last_event_at`）：编辑动作只截断日志、不改这一列的话，被改动的会话会按
  // **创建时间**沉到列表后面——现场就是「重试过的会话掉进折叠的其余会话里」。
  test("rewind 之后被改动的会话在 rows 里排到最前", async () => {
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

    // 没有运行中的 agent 也能跑的动作：截断一次日志（不改「创建时间」，只让最近活动前进）。
    expect(
      errorCodeOf(
        await entry.handlers.invoke("sessionEditor/rewind", {
          request: { sessionId: "row-older", toBoundary: 5 },
        }),
      ),
    ).toBeUndefined();

    expect(await orderOf(), "改动是「现在」发生的活动，列表要按它重新排序").toEqual([
      "row-older",
      "row-newer",
    ]);
  });

  test("rows 给出会话行（含标题与归档标记）并按页返回", async () => {
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

  test("rows 的搜索与子代理过滤在后端做", async () => {
    const entry = await start();
    await seed(entry, "searchable");

    const none = valueOf<{ total: number }>(
      await entry.handlers.invoke("sessionAdmin/rows", { request: { query: "不存在的标题" } }),
    );
    expect(none.total).toBe(0);
  });

  test("usage 回报总量、子代理拆分、按天桶与按会话行（形状与契约一致）", async () => {
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

  test("usage 的 range 只影响统计窗口，不影响返回形状", async () => {
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

  test("rows 的页码越界带 SESSION_ROWS_INVALID_PAGE（不是网关兜底码）", async () => {
    const entry = await start();
    await seed(entry, "page-oob");

    const tooDeep = await entry.handlers.invoke("sessionAdmin/rows", { request: { page: 1e9 } });
    expect(errorCodeOf(tooDeep)).toBe("SESSION_ROWS_INVALID_PAGE");

    // 分页参数在宿主夹住：非整数与越界值**不**报错，回落到默认那一页。
    const sloppy = valueOf<{ page: number; pageSize: number }>(
      await entry.handlers.invoke("sessionAdmin/rows", { request: { page: 1.5, pageSize: -3 } }),
    );
    expect(sloppy.page).toBe(1);
    expect(sloppy.pageSize).toBeGreaterThan(0);
  });

  test("usage 的未知 range 带 SESSION_USAGE_INVALID_RANGE（不静默降级成 all）", async () => {
    const entry = await start();
    await seed(entry, "usage-bad-range");

    const bad = await entry.handlers.invoke("sessionAdmin/usage", { request: { range: "1y" } });
    expect(errorCodeOf(bad)).toBe("SESSION_USAGE_INVALID_RANGE");
  });

  test("export 给 base64 的 zip；import 能把它读回来", async () => {
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

  test("exportMany 逐条给出 zip（每条一份，文件名按会话）与不存在那条的域码", async () => {
    const entry = await start();
    await seed(entry, "batch-a", oneTurnLogStepFirst());
    await seed(entry, "batch-b");

    const result = await entry.handlers.invoke("sessionAdmin/exportMany", {
      request: { sessionIds: ["batch-a", "absent", "batch-b"] },
    });

    const value = valueOf<{
      items: { sessionId: string; ok: boolean; code?: string; filename?: string; zip?: string }[];
    }>(result);
    expect(
      value.items.map(({ sessionId, ok, code, filename }) => ({ sessionId, ok, code, filename })),
    ).toEqual([
      { sessionId: "batch-a", ok: true, code: undefined, filename: "batch-a.zip" },
      { sessionId: "absent", ok: false, code: "SESSION_NOT_FOUND", filename: undefined },
      { sessionId: "batch-b", ok: true, code: undefined, filename: "batch-b.zip" },
    ]);
    expect(value.items[0]?.zip?.length).toBeGreaterThan(0);
  });

  test("importMany 逐条导入：好包建成新会话，坏包带域码（整批不回滚）", async () => {
    const entry = await start();
    await seed(entry, "batch-source", oneTurnLogStepFirst());
    const exported = valueOf<{ items: { zip: string }[] }>(
      await entry.handlers.invoke("sessionAdmin/exportMany", {
        request: { sessionIds: ["batch-source"] },
      }),
    );
    const good = exported.items[0]?.zip ?? "";
    // 一份合法的 zip，但没有上游 format 的 artifact 行。
    const badZip = await zipOf({ "notes.txt": strToU8("not a session") });
    const bad = Buffer.from(badZip).toString("base64");

    const result = await entry.handlers.invoke("sessionAdmin/importMany", {
      request: { zips: [good, bad] },
    });

    const value = valueOf<{
      items: { sessionId: string; ok: boolean; code?: string; filename?: string }[];
    }>(result);
    expect(value.items[0]).toMatchObject({
      ok: true,
      filename: sessionFormatLogFilename(SESSION_FORMAT_VERSION),
    });
    expect(value.items[1]).toMatchObject({ ok: false, code: "SESSION_IMPORT_NO_ARTIFACT" });
    // 成功的那个读得出来（源会话 6 条事件）。
    const reader = await entry.persistence.open(SessionId(value.items[0]?.sessionId ?? ""), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events).toHaveLength(6);
  });

  test("delete 拒绝未归档的会话（码带到 wire 上）", async () => {
    const entry = await start();
    await seed(entry, "not-archived");

    const result = await entry.handlers.invoke("sessionAdmin/delete", {
      request: { sessionId: "not-archived" },
    });

    expect(errorCodeOf(result)).toBe("SESSION_NOT_ARCHIVED");
  });

  test("delete 拒绝不存在的会话", async () => {
    const entry = await start();

    const result = await entry.handlers.invoke("sessionAdmin/delete", {
      request: { sessionId: "absent" },
    });

    expect(errorCodeOf(result)).toBe("SESSION_NOT_FOUND");
  });

  test("bulkDelete 逐条返回结果：可删的删掉，未归档的带 SESSION_NOT_ARCHIVED（整批不回滚）", async () => {
    const entry = await start();
    await seed(entry, "bulk-deletable", oneTurnLogStepFirst());
    await seed(entry, "bulk-kept", oneTurnLogStepFirst());
    const sqlite = await openInitializedSqlite(
      join(entry.root, "sessions", "sessions.sqlite"),
      "wal",
    );
    try {
      sqlite.exec("UPDATE t_sessions SET f_archived_at = 1 WHERE f_session_id = 'bulk-deletable'");
    } finally {
      sqlite.close();
    }

    const result = await entry.handlers.invoke("sessionAdmin/bulkDelete", {
      request: { sessionIds: ["bulk-deletable", "bulk-kept", "absent"] },
    });

    const value = valueOf<{
      items: { sessionId: string; ok: boolean; code?: string }[];
    }>(result);
    expect(value.items).toEqual([
      { sessionId: "bulk-deletable", ok: true },
      { sessionId: "bulk-kept", ok: false, code: "SESSION_NOT_ARCHIVED" },
      { sessionId: "absent", ok: false, code: "SESSION_NOT_FOUND" },
    ]);
    // 整批不回滚：已提交的删除保留，失败的会话仍在列表里。
    const rows = valueOf<{ items: { sessionId: string }[] }>(
      await entry.handlers.invoke("sessionAdmin/rows", { request: { page: 1, pageSize: 10 } }),
    );
    expect(rows.items.map((item) => item.sessionId)).toEqual(["bulk-kept"]);
  });

  test("rows 的结构化过滤（归档 / 来源 / 时间）在宿主侧生效", async () => {
    const entry = await start();
    await seed(entry, "filter-archived", oneTurnLogStepFirst());
    await seed(entry, "filter-kept", twoTurnLog());
    const sqlite = await openInitializedSqlite(
      join(entry.root, "sessions", "sessions.sqlite"),
      "wal",
    );
    try {
      sqlite.exec("UPDATE t_sessions SET f_archived_at = 1 WHERE f_session_id = 'filter-archived'");
    } finally {
      sqlite.close();
    }

    const archived = valueOf<{ items: { sessionId: string }[] }>(
      await entry.handlers.invoke("sessionAdmin/rows", {
        request: { page: 1, pageSize: 10, archived: "only" },
      }),
    );
    expect(archived.items.map((item) => item.sessionId)).toEqual(["filter-archived"]);

    const unarchived = valueOf<{ items: { sessionId: string }[] }>(
      await entry.handlers.invoke("sessionAdmin/rows", {
        request: { page: 1, pageSize: 10, archived: "unarchived", updatedAfter: 6 },
      }),
    );
    expect(unarchived.items.map((item) => item.sessionId)).toEqual(["filter-kept"]);
  });

  test("organize 停掉运行中的 agent、回收孤儿并重算统计", async () => {
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

  test("locate 回命中片段与窗口（事件文本一律 LIKE，条件下推到宿主）", async () => {
    const entry = await start();
    await seed(
      entry,
      "locate-1",
      turnLog(0, 1, { users: [{ id: "locate-u", text: "定位这一段输入" }] }),
    );

    const result = await entry.handlers.invoke("sessionAdmin/locate", {
      request: { sessionId: "locate-1", text: "定位" },
    });

    const value = valueOf<{
      items: { seq: number; snippet: string; type: string }[];
      total: number;
      window: { fromSeq: number; toSeq: number };
    }>(result);
    expect(value.items.map((item) => item.seq)).toEqual([2, 3]);
    expect(value.items[0]).toMatchObject({ type: "user/message" });
    expect(value.items[0]?.snippet).toContain("定位");
    expect(value.total).toBe(2);
    expect(value.window).toEqual({ fromSeq: 0, toSeq: 5 });
  });

  test("locate 的窗口越界把 SESSION_QUERY_INVALID_WINDOW 带到 wire 上", async () => {
    const entry = await start();
    await seed(entry, "locate-oob");

    const result = await entry.handlers.invoke("sessionAdmin/locate", {
      request: { sessionId: "locate-oob", toSeq: 99 },
    });

    expect(errorCodeOf(result)).toBe("SESSION_QUERY_INVALID_WINDOW");
  });

  test("repair 修掉坏尾部并回报保留 / 丢弃条数", async () => {
    const entry = await start();
    await seed(entry, "repair-tail", twoTurnLog());
    await corruptEvent(entry, "repair-tail", 4);

    const result = await entry.handlers.invoke("sessionAdmin/repair", {
      request: { sessionId: "repair-tail", action: "drop-tail" },
    });

    expect(valueOf(result)).toEqual({
      sessionId: "repair-tail",
      action: "drop-tail",
      keptEvents: 4,
      droppedEvents: 8,
    });
    const reader = await entry.persistence.open(SessionId("repair-tail"), "read");
    const events = (await reader.read()).events;
    await reader.close();
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3]);
  });

  test("repair 删除未归档的会话带 SESSION_NOT_ARCHIVED（删除守卫原样到 wire）", async () => {
    const entry = await start();
    await seed(entry, "repair-kept");

    const result = await entry.handlers.invoke("sessionAdmin/repair", {
      request: { sessionId: "repair-kept", action: "delete" },
    });

    expect(errorCodeOf(result)).toBe("SESSION_NOT_ARCHIVED");
  });

  test("repair 的非法 action 带自己的域码，不是网关兜底码", async () => {
    const entry = await start();
    await seed(entry, "repair-bogus");

    const result = await entry.handlers.invoke("sessionAdmin/repair", {
      request: { sessionId: "repair-bogus", action: "rebuild" },
    });

    // 契约是三个修法的联合类型，wire 上仍是任意字符串：未知动作是「入参不合法」，要有可分的码。
    expect(errorCodeOf(result)).toBe("SESSION_REPAIR_INVALID_ACTION");
  });

  test("consistency 回报体检结果：干净库 ok，扫过的行数给出", async () => {
    const entry = await start();
    await seed(entry, "check-clean", oneTurnLogStepFirst());

    const result = await entry.handlers.invoke("sessionAdmin/consistency", {});

    const value = valueOf<{
      ok: boolean;
      checked: { sessions: number; events: number };
      issues: readonly unknown[];
    }>(result);
    expect(value.ok).toBe(true);
    expect(value.issues).toEqual([]);
    expect(value.checked).toMatchObject({ sessions: 1, events: 6 });
  });

  test("consistency 把派生统计的不一致项列出来（ok 为假）", async () => {
    const entry = await start();
    await seed(entry, "check-drifted", twoTurnLog());
    const sqlite = await openInitializedSqlite(
      join(entry.root, "sessions", "sessions.sqlite"),
      "wal",
    );
    try {
      sqlite.exec("DELETE FROM t_session_counts WHERE f_session_id = 'check-drifted'");
    } finally {
      sqlite.close();
    }

    const result = await entry.handlers.invoke("sessionAdmin/consistency", {});

    const value = valueOf<{
      ok: boolean;
      issues: { kind: string; subject: string; detail: string }[];
    }>(result);
    expect(value.ok).toBe(false);
    const issue = value.issues.find((item) => item.kind === "session-counts-missing");
    expect(issue?.subject).toBe("check-drifted");
    expect(issue?.detail).toContain("f_turns");
  });
});

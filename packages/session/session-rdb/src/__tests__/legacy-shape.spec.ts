import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Context } from "@deepseek-ai/cordis";
import { SessionSeq, SessionStore } from "@deepseek-ai/dsh-session";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import {
  ToolCallId,
  createMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SessionPersistenceSqlite from "@morlay/session-rdb";
import { meta } from "@morlay/session-rdb/testing";
import { needsShapeAdoption, normalizeToCurrentShape } from "../log.ts";

/**
 * 旧代消息形状的读取（2026-09-22 的现场问题）：迁移链是**严格**的——它拒绝我们当年写过、后来被
 * 上游退役的形状（`request/header.header.system`、自造事件类型、inbox 的旧拼接形状），于是这些会话
 * 落到回退视图（adopt）。回退视图因此必须自己把形状归一到当前格式，否则它们全部打不开。
 *
 * 另一类更隐蔽：写路径曾把回退视图的结果以**当前版本号**落库（「v4 标记 + 旧代形状」），所以版本号
 * 不足以决定走哪条路——读之前要按内容再判一次。
 */

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function freshDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-legacy-shape-"));
  dirs.push(dir);
  return join(dir, "sessions.sqlite");
}

interface LoadedLog {
  events: readonly {
    type: string;
    ignorable?: true;
    data: { message?: { role?: string; source?: { kind?: string } } };
  }[];
}

async function openHarness(path: string): Promise<{
  persistence: SessionPersistenceSqlite;
  load: (id: string) => Promise<LoadedLog>;
  dispose: () => Promise<void>;
}> {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  new SessionProjectionRegistry(ctx);
  const fiber = await ctx.plugin(SessionPersistenceSqlite, { type: "sqlite", path });
  // 表在 init 里建：先让 ready 落定，再允许直接 SQL 插入旧形状的行。
  const persistence = ctx.sessionPersistence as SessionPersistenceSqlite;
  await persistence.list();
  const internals = (
    persistence as unknown as {
      internals(): { load(id: string): Promise<LoadedLog> };
    }
  ).internals();
  return { persistence, load: (id) => internals.load(id), dispose: () => fiber.dispose() };
}

/** 一条当前形状的日志：写路径正常落库，随后用 SQL 把两处消息形状改回旧代。 */
function currentShapeLog(): SessionEvent[] {
  const callId = ToolCallId("call-1");
  return [
    { type: "turn/start", seq: SessionSeq(0), time: 1, data: { turn: 1 } },
    {
      type: "system/message",
      seq: SessionSeq(1),
      time: 2,
      data: {
        turn: 1,
        step: 1,
        message: createMessage({
          role: "system",
          content: [{ type: "text", text: "你是助手" }],
          source: { kind: "system-prompt" },
        }),
      },
      surfaceOp: "append",
    },
    {
      type: "user/message",
      seq: SessionSeq(2),
      time: 3,
      data: createUserMessage({
        content: [{ type: "text", text: "hi" }],
        source: { kind: "user" },
      }),
      surfaceOp: "append",
    },
    {
      type: "tool/result",
      seq: SessionSeq(3),
      time: 4,
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId,
          content: [{ type: "text", text: "42" }],
          isError: false,
        }),
      },
      surfaceOp: "append",
    },
  ] as unknown as SessionEvent[];
}

/** 把已落库的两条消息改回旧代形状（`source: plugin` 的 system、user 角色的 tool-result）。 */
function rewriteToLegacyShapes(path: string, id: string): void {
  const db = new DatabaseSync(path);
  try {
    const sequence = (seq: number): string =>
      `(SELECT f_event_id FROM t_session_events WHERE f_session_id = '${id}' AND f_sequence = ${String(seq)})`;
    db.prepare(`UPDATE t_events SET f_data = ? WHERE f_event_id = ${sequence(1)}`).run(
      JSON.stringify({
        turn: 1,
        step: 1,
        message: {
          id: "m-system",
          role: "system",
          content: [{ type: "text", text: "你是助手" }],
          source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" },
        },
      }),
    );
    db.prepare(`UPDATE t_events SET f_data = ? WHERE f_event_id = ${sequence(3)}`).run(
      JSON.stringify({
        turn: 1,
        step: 1,
        message: {
          id: "m-tool",
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              content: [{ type: "text", text: "42" }],
              isError: false,
            },
          ],
          source: { kind: "tool", callId: "call-1" },
        },
      }),
    );
  } finally {
    db.close();
  }
}

describe("旧代消息形状的读取", () => {
  it("normalizes the retired shapes in place", () => {
    const events = [
      {
        type: "system/message",
        seq: SessionSeq(1),
        time: 1,
        data: {
          turn: 1,
          step: 1,
          message: { source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" } },
        },
      },
      {
        type: "tool/result",
        seq: SessionSeq(2),
        time: 2,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: "user",
            content: [{ type: "tool-result", toolCallId: "call-1", content: [], isError: true }],
            source: { kind: "tool", callId: "call-1" },
          },
        },
      },
      { type: "session-branch/version", seq: SessionSeq(3), time: 3, data: { version: 1 } },
      { type: "turn/start", seq: SessionSeq(4), time: 4, data: { turn: 1 } },
    ] as unknown as SessionEvent[];

    normalizeToCurrentShape(events);

    const system = events[0] as unknown as { data: { message: { source: unknown } } };
    expect(system.data.message.source).toEqual({ kind: "system-prompt" });
    const tool = events[1] as unknown as {
      data: { message: { role: string; toolCallId: string; content: unknown[]; isError: boolean } };
    };
    expect(tool.data.message).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      content: [],
      isError: true,
    });
    expect((events[2] as unknown as { ignorable?: true }).ignorable).toBe(true);
    // 已知的当前形状不动。
    expect((events[3] as unknown as { ignorable?: true }).ignorable).toBeUndefined();
  });

  it("marks our own event types ignorable, whoever wrote them (retired or current)", () => {
    // 上游的已知类型表由上游仓库的声明生成，我们自造的类型按构造就在它之外——读路径因此统一补
    // `ignorable: true`（真回归：`session-mode/selected` 漏登记时整个会话打不开）。
    const events = [
      { type: "session-mode/selected", seq: SessionSeq(0), time: 0, data: { sessionMode: "chat" } },
      { type: "agent-preset/selected", seq: SessionSeq(1), time: 1, data: { agentPreset: "chat" } },
    ] as unknown as SessionEvent[];

    normalizeToCurrentShape(events);

    expect((events[0] as unknown as { ignorable?: true }).ignorable).toBe(true);
    // 上游已知的类型不动：它是必需事件，不该被当作可忽略的。
    expect((events[1] as unknown as { ignorable?: true }).ignorable).toBeUndefined();
    expect(
      needsShapeAdoption([
        { type: "session-mode/selected", seq: SessionSeq(0), time: 0, data: {} },
      ] as unknown as SessionEvent[]),
    ).toBe(true);
  });

  it("flags only the retired own event types and the old message shapes", () => {
    expect(
      needsShapeAdoption([
        { type: "session-branch/version", seq: SessionSeq(0), time: 0, data: {} },
      ] as unknown as SessionEvent[]),
    ).toBe(true);
    expect(
      needsShapeAdoption([
        {
          type: "system/message",
          seq: SessionSeq(0),
          time: 0,
          data: { message: { source: { kind: "system-prompt" } } },
        },
      ] as unknown as SessionEvent[]),
    ).toBe(false);
    // 未知的**别家**类型不是「旧形状」：它们保持 fail loud（那可能是更新版本的 harness 写的）。
    expect(
      needsShapeAdoption([
        { type: "some-future/event", seq: SessionSeq(0), time: 0, data: {} },
      ] as unknown as SessionEvent[]),
    ).toBe(false);
  });

  it("loads a v3 session whose events carry the retired shapes", async () => {
    const path = await freshDbPath();
    const { persistence, load, dispose } = await openHarness(path);
    try {
      await persistence.createAndAppend(meta("legacy-v3"), currentShapeLog());
      rewriteToLegacyShapes(path, "legacy-v3");

      const { events } = await load("legacy-v3");
      const system = events.find((event) => event.type === "system/message");
      expect(system?.data.message?.source?.kind).toBe("system-prompt");
      const tool = events.find((event) => event.type === "tool/result");
      expect(tool?.data.message?.role).toBe("tool");
    } finally {
      await dispose();
    }
  });

  it("loads a session carrying our own current event type (session-mode/selected)", async () => {
    // 上游的持久化校验只放行「已知类型」或「带可忽略信封的未知类型」，而我们自造的类型按构造就在已知表之外：
    // 会话里一旦有它，读路径必须先把信封补上（真回归：漏登记时整个会话打不开）。
    const path = await freshDbPath();
    const { persistence, load, dispose } = await openHarness(path);
    try {
      await persistence.createAndAppend(meta("own-current-event"), [
        ...currentShapeLog(),
        {
          type: "session-mode/selected",
          seq: SessionSeq(4),
          time: 5,
          data: { sessionMode: "chat" },
        },
      ] as unknown as SessionEvent[]);

      const { events } = await load("own-current-event");

      const selected = events.find((event) => event.type === "session-mode/selected");
      expect(selected).toBeDefined();
      expect((selected as unknown as { ignorable?: true }).ignorable).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("loads a current-version session whose events are still the retired shapes", async () => {
    // 写路径曾把回退视图的结果以当前版本号落库——版本号不可信，按内容判。
    const path = await freshDbPath();
    const { persistence, load, dispose } = await openHarness(path);
    try {
      await persistence.createAndAppend(meta("mislabeled-v4"), currentShapeLog());
      rewriteToLegacyShapes(path, "mislabeled-v4");

      const { events } = await load("mislabeled-v4");

      expect(events).toHaveLength(currentShapeLog().length);
      const system = events.find((event) => event.type === "system/message");
      expect(system?.data.message?.source?.kind).toBe("system-prompt");
    } finally {
      await dispose();
    }
  });
});

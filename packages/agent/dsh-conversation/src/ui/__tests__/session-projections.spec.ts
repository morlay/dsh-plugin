// @vitest-environment happy-dom
/**
 * 会话数据面的**投影读面**：`binding().session.projections.faceOf(key)`。
 *
 * 这是上游 `ui-model-selection`（模型选择器）与 `ui-conversation` 的输入区读投影的唯一入口：
 * `ModelDirectory` 构造时拿 `faceOf('modelSelection')`，它的快照是 `undefined` 时状态就停在
 * `loading`（界面上按钮永远是「正在加载模型…」）。
 *
 * 数据来源两条，语义与上游 `ProjectionValueStore` 一致：
 * - 目录行的 `projections` 块（`session/list` 的 cached 提示）；
 * - `session/follow` 首帧的 `projections.values`（Host 的 sequenced 值，优先级更高）。
 *
 * 只替传输层（`FakeRemote` 给固定帧），store 与投影读面都是真实现。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { mockTransport, SessionRemoteDefault } from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";
import { SessionController } from "../../contract/session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";
import { FakeRemote } from "./support/fake-remote.ts";

/** 一个模型选择投影的 wire 值（`modelSelection` 的 view：`{ lastUsed, next }`）。 */
const MODEL_SELECTION = {
  lastUsed: null,
  next: { provider: "deepseek-official", model: "deepseek-flash" },
};

/** 一行宿主的会话摘要。 */
function summaryOf(id: string, projections?: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    sessionId: id,
    title: `会话 ${id}`,
    cwd: "/tmp/w",
    blank: false,
    running: false,
    agentAvailable: true,
    updatedAt: 1,
    retainedBy: {},
    ...(projections === undefined
      ? {}
      : { projections: { kind: "cached", asOfSeq: 1, values: projections } }),
  };
}

/** 一条 `session/follow` 首帧（上游 `SessionFollowSnapshot` 的 wire 形状）。 */
function followSnapshot(values: Record<string, unknown>): unknown {
  return {
    type: "snapshot",
    header: { version: 1, id: "s1", createdAt: 1, isSeeded: false, cwd: "/tmp/w" },
    // 空窗口的游标是 `-1`（上游 `SessionEventStream` 的 `emptyCursor`）：给 0 会被判成
    // 「page 没有落在请求的游标上」。
    cursor: -1,
    records: [],
    hasMore: false,
    projections: { asOfSeq: 0, values },
    // 事件流 opt-in 了 assistant 基线：首帧不带它，上游会判成协议错误并放弃整个窗口。
    assistantStream: { revision: 0 },
  };
}

/**
 * 起真 store + 假传输（一行的目录 + 一条带投影的 follow 首帧）。
 * @param listRow - `session/list` 返回的那一行。
 * @param frameValues - `session/follow` 首帧的 `projections.values`。
 * @returns 应用与契约实例。
 */
async function boot(
  listRow: Record<string, unknown>,
  frameValues: Record<string, unknown>,
): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>>; sessions: SessionController }> {
  FakeRemote.next = {
    handlers: { "session/list": () => ({ items: [listRow] }) },
    streams: {
      // 首帧之后保持长流（宿主在关会话时才断）；按 `signal` 收尾，否则 `dispose()` 会挂在这一代。
      "session/follow": async function* (_payload: unknown, signal: AbortSignal) {
        yield followSnapshot(frameValues);
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
      },
    } as Parameters<typeof mockTransport>[1],
  };
  const app = await bootstrapApplication({
    providers: [...provideSessionsStore(), FakeRemote, SessionRemoteDefault],
    timeoutMs: 8_000,
  });
  const sessions = app.get(SessionController);
  // 装配时的那次目录拉取是 fire-and-forget：`retain` 之前先等它落地（否则 `resolveTarget` 报 unknown session）。
  await sessions.refresh();
  // 上游 `ClientSessions.binding(id)` 读的是**已物化的 scope**（`scopes.get(id)?.binding`）：
  // 目录里有行还不够，要先 `retain` 一次才会建 scope。`ui-session` 的 `publishMain` 正是这么做的。
  sessions.retain(String(listRow["id"]) as never, { source: "gateway" });
  return { app, sessions };
}

/** binding 上的投影读面（上游 `ProjectionsFace` 的最小形状）。 */
interface ProjectionsFace {
  faceOf(key: string): { getSnapshot(): unknown; subscribe(listener: () => void): () => void };
}

/**
 * 取某个会话的投影读面。
 * @param sessions - 契约实例。
 * @param id - 会话身份。
 * @returns 读面；binding 不存在时 `undefined`。
 */
function projectionsOf(sessions: SessionController, id: string): ProjectionsFace | undefined {
  const binding = sessions.binding(id) as
    | { session?: { projections: ProjectionsFace } }
    | undefined;
  return binding?.session?.projections;
}

/** 等条件成立（follow 首帧是异步到达的，别用固定时长猜）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("会话数据面的投影读面（faceOf）", { timeout: 10_000 }, () => {
  it("`session/follow` 首帧的 projections.values 能被 faceOf 读到（模型选择器据此进入 ready）", async () => {
    const { app, sessions } = await boot(summaryOf("s1"), { modelSelection: MODEL_SELECTION });
    try {
      const projections = projectionsOf(sessions, "s1");
      expect(projections, "binding 必须带投影读面").toBeDefined();

      const face = projections?.faceOf("modelSelection");
      expect(face).toBeDefined();
      // 首帧到达前是「键缺失」（undefined），到达后必须是真值——停在 undefined 就是永远 loading。
      await until(() => face?.getSnapshot() !== undefined);
      expect(face?.getSnapshot()).toEqual(MODEL_SELECTION);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("目录行上的 projections 块也是初值（帧到达前就能读到）", async () => {
    const { app, sessions } = await boot(summaryOf("s1", { modelSelection: MODEL_SELECTION }), {});
    try {
      const face = projectionsOf(sessions, "s1")?.faceOf("modelSelection");
      expect(face?.getSnapshot(), "行上的 cached 值应当直接可读").toEqual(MODEL_SELECTION);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("faceOf 是 identity-stable 的，且订阅者能收到帧带来的变化", async () => {
    const { app, sessions } = await boot(summaryOf("s1"), { modelSelection: MODEL_SELECTION });
    try {
      const projections = projectionsOf(sessions, "s1") as ProjectionsFace;
      expect(projections.faceOf("modelSelection")).toBe(projections.faceOf("modelSelection"));
      let notified = 0;
      const stop = projections.faceOf("modelSelection").subscribe(() => {
        notified += 1;
      });
      await until(() => projections.faceOf("modelSelection").getSnapshot() !== undefined);
      expect(notified, "投影值到达时订阅者要被通知（组件才会重渲染）").toBeGreaterThan(0);
      stop();
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});

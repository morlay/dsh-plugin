// @vitest-environment happy-dom
/**
 * 会话数据面的**投影读面**：`binding().session.projections.faceOf(key)`。
 *
 * 这是上游 `ui-model-selection`（模型选择器）与 `ui-conversation` 的输入区读投影的唯一入口：
 * `ModelDirectory` 构造时拿 `faceOf('modelSelection')`，它的快照是 `undefined` 时状态就停在
 * `loading`（界面上按钮永远是「正在加载模型…」）。
 *
 * 数据来源两条，语义与上游 `ProjectionValueStore` 一致：
 * - 目录行的 `projectionValues`（`session/list` 的 cached 值）；
 * - `session/follow` 首帧的 `projections.values`（Host 的 sequenced 值，优先级更高）。
 *
 * 只替传输层（`FakeRemote` 给固定帧），store 与投影读面都是真实现。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { mockTransport, SessionRemoteDefault } from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";
import { SessionController } from "../session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";
import { FakeRemote } from "./support/fake-remote.ts";

/** 一个模型选择投影的 wire 值（`modelSelection` 的 view：`{ lastUsed, next }`）。 */
const MODEL_SELECTION = {
  lastUsed: null,
  next: { provider: "deepseek-official", model: "deepseek-flash" },
};

/** 一行宿主的会话摘要。 */
function summaryOf(id: string, projectionValues?: Record<string, unknown>): Record<string, unknown> {
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
    ...(projectionValues === undefined ? {} : { projectionValues }),
  };
}

/** 一条 `session/follow` 首帧（上游 `SessionFollowSnapshot` 的 wire 形状）。 */
function followSnapshot(values: Record<string, unknown>): unknown {
  return {
    type: "snapshot",
    header: { version: 1, id: "s1", createdAt: 1, isSeeded: false, cwd: "/tmp/w" },
    cursor: 0,
    records: [],
    hasMore: false,
    projections: { asOfSeq: 0, values },
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
    handlers: { "session/list": () => ({ ids: ["s1"], byId: { s1: listRow } }) },
    streams: {
      "session/follow": async function* () {
        yield followSnapshot(frameValues);
      },
    } as Parameters<typeof mockTransport>[1],
  };
  const app = await bootstrapApplication({
    providers: [...provideSessionsStore(),
    FakeRemote, SessionRemoteDefault],
    timeoutMs: 8_000,
  });
  return { app, sessions: app.get(SessionController) };
}

/** 等条件成立（follow 首帧是异步到达的，别用固定时长猜）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** binding 上的投影读面（上游 `ProjectionsFace` 的最小形状）。 */
interface ProjectionsFace {
  faceOf(key: string): { getSnapshot(): unknown; subscribe(listener: () => void): () => void };
}

describe("会话数据面的投影读面（faceOf）", { timeout: 10_000 }, () => {
  it("`session/follow` 首帧的 projections.values 能被 faceOf 读到（模型选择器据此进入 ready）", async () => {
    const { app, sessions } = await boot(summaryOf("s1"), { modelSelection: MODEL_SELECTION });
    try {
      const binding = sessions.binding("s1") as { session: { projections: ProjectionsFace } } | undefined;
      expect(binding).toBeDefined();
      const face = binding?.session.projections.faceOf("modelSelection");
      expect(face).toBeDefined();
      // 首帧到达前是「键缺失」（undefined），到达后必须是真值——停在 undefined 就是永远 loading。
      await until(() => face?.getSnapshot() !== undefined);
      expect(face?.getSnapshot()).toEqual(MODEL_SELECTION);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("目录行上的 projectionValues 也是初值（帧到达前就能读到）", async () => {
    const { app, sessions } = await boot(
      summaryOf("s1", { modelSelection: MODEL_SELECTION }),
      {},
    );
    try {
      const binding = sessions.binding("s1") as { session: { projections: ProjectionsFace } } | undefined;
      const face = binding?.session.projections.faceOf("modelSelection");
      expect(face?.getSnapshot(), "行上的 cached 值应当直接可读").toEqual(MODEL_SELECTION);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("faceOf 是 identity-stable 的，且订阅者能收到帧带来的变化", async () => {
    const { app, sessions } = await boot(summaryOf("s1"), { modelSelection: MODEL_SELECTION });
    try {
      const binding = sessions.binding("s1") as { session: { projections: ProjectionsFace } } | undefined;
      const projections = binding?.session.projections;
      expect(projections?.faceOf("modelSelection")).toBe(projections?.faceOf("modelSelection"));
      let notified = 0;
      const stop = projections?.faceOf("modelSelection").subscribe(() => { notified += 1; });
      await until(() => projections?.faceOf("modelSelection").getSnapshot() !== undefined);
      expect(notified, "投影值到达时订阅者要被通知（组件才会重渲染）").toBeGreaterThan(0);
      stop?.();
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});

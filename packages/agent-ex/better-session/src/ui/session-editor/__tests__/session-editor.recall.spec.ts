// @vitest-environment happy-dom
// **撤回的全链路**：happy-dom 里真点「编辑」→「撤回并编辑」→ 真 wire（`sessionEditor/recall`）→ 真会话库。
//
// 判据全部**读库**：日志截到边界、投影检查点（`sessionProjectionCache`）的水位同步前进、
// **重开实例**后仍是撤回后的样子（撤回是持久化事实，不是内存状态）。
import { SessionId } from "@morlay/dsh-session/contract";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionProjectionCacheRdb } from "@morlay/better-session";
import { startClient } from "../../../__tests__/support/e2e-client.ts";
import { startHost, type Host } from "../../../__tests__/support/e2e-host.ts";
import { nodeOf, renderUserMessage } from "../../../__tests__/support/e2e-render.tsx";
import { waitFor } from "../../../__tests__/support/wait.ts";
import { meta, turnLog } from "@morlay/dsh-session/testing";

const opened: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  cleanup();
  for (const item of opened.splice(0).reverse()) await item.dispose();
});

// 三个闭合回合，每回合 6 条事件（turn/start … turn/end）。
function threeTurnLog() {
  return [...turnLog(0, 1), ...turnLog(6, 2), ...turnLog(12, 3)];
}

const seqsOf = (events: readonly { seq: unknown }[]): number[] =>
  events.map((e) => e.seq as number);

// 检查点行里的水位（`turnOutline` 这一行就是消息流折叠的位置）。
function watermarkOf(dbPath: string, id: string): number | undefined {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare(
        "SELECT f_seq FROM t_session_projcache_row WHERE f_session_id = ? AND f_key = 'turnOutline'",
      )
      .get(id) as { f_seq: number } | undefined;
    return row?.f_seq;
  } finally {
    db.close();
  }
}

function outlineOf(host: Host, id: string): number[] | undefined {
  const cache = host.ctx.get("sessionProjectionCache") as SessionProjectionCacheRdb | undefined;
  const header = host.ctx.sessions.get(SessionId(id))?.header ?? meta(id, "/work");
  const outline = cache?.cachedSnapshot(header)?.values["turnOutline"];
  return Array.isArray(outline)
    ? outline.map((entry) => (entry as { turn: number }).turn)
    : undefined;
}

describe("撤回：点编辑 → 撤回并编辑", () => {
  it(
    "日志截到边界、检查点水位同步前进、重开实例后仍是撤回后的样子",
    { timeout: 90_000 },
    async () => {
      // 数据根由**用例**持有：撤回要验「重开实例」，第一次 dispose 不能把库删掉。
      const root = await mkdtemp(join(tmpdir(), "better-session-recall-"));
      opened.push({ dispose: async () => rm(root, { recursive: true, force: true }) });
      const host = await startHost({ root });
      opened.push(host);
      const id = "recall-target";
      const live = host.ctx.sessions.create(SessionId(id), {
        meta: meta(id, "/work"),
        seed: threeTurnLog(),
      });
      await host.ctx.sessions.flush(live);
      host.agentDirectory.attach(live);
      const client = await startClient(host.handlers);
      opened.push(client);

      // 撤回前：检查点把三轮都折进去了（水位在最后一条 turn/end 上）。
      const beforeWatermark = await waitFor(
        () => watermarkOf(host.dbPath, id),
        (seq) => seq !== undefined && seq >= 17,
        "撤回前检查点没有写到位",
      );
      if (beforeWatermark === undefined) throw new Error("撤回前检查点没有写到位");
      expect(outlineOf(host, id)).toEqual([1, 2, 3]);

      const before = await host.eventsOf(id);
      renderUserMessage({ node: nodeOf(before, 8), face: client.store.faceOf(id) });
      fireEvent.click(screen.getByLabelText("编辑"));
      fireEvent.click(screen.getByText("撤回并编辑"));

      // ① 日志截到边界：第一个回合的 turn/end 之后什么都不剩。
      const truncated = await waitFor(
        () => host.eventsOf(id),
        (events) => events.length === 6,
        "撤回没有把日志截到边界",
      );
      expect(seqsOf(truncated)).toEqual([0, 1, 2, 3, 4, 5]);

      // ② 检查点**同步前进**：水位不越过新的 head，折叠结果只剩第一个回合。
      const afterWatermark = await waitFor(
        () => watermarkOf(host.dbPath, id),
        (seq) => seq !== undefined && seq <= 5,
        "撤回后检查点水位没有跟着截断（读路径会继续喂撤回前的快照）",
      );
      expect(afterWatermark).toBeLessThan(beforeWatermark);
      expect(outlineOf(host, id)).toEqual([1]);

      // ③ 重开实例（同一个库文件）：撤回是持久化事实。
      await host.dispose();
      opened.splice(opened.indexOf(host), 1);
      const reopened = await startHost({ root });
      opened.push(reopened);
      expect(seqsOf(await reopened.eventsOf(id))).toEqual([0, 1, 2, 3, 4, 5]);
      expect(outlineOf(reopened, id)).toEqual([1]);
      expect(watermarkOf(reopened.dbPath, id)).toBeLessThanOrEqual(5);
    },
  );
});

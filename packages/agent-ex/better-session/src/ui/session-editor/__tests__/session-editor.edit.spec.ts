// @vitest-environment happy-dom
// **编辑的全链路**：happy-dom 里真点「编辑」→ 真 wire（`sessionEditor/recall`）→ 真编辑编排 → 真会话库。
//
// 判据全部**读库**：日志被截到目标回合之前、草稿收到该消息的全部文本块、改完提交后新文本成为该回合的用户输入。
// 换掉的只有两处，都不是本包的职责：
//   - 传输：进程内 dispatch（`LocalRemote`）代替 mux socket；
//   - composer 面（草稿与窗口重建）与模型输出：记录型替身（真 composer 的端到端在 apps 层覆盖）。
import { SessionId } from "@morlay/dsh-session/contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { startClient, type Client } from "../../../__tests__/support/e2e-client.ts";
import { MOCK_REPLY_PREFIX, startHost, type Host } from "../../../__tests__/support/e2e-host.ts";
import { nodeOf, renderUserMessage } from "../../../__tests__/support/e2e-render.tsx";
import { waitFor } from "../../../__tests__/support/wait.ts";
import { meta, twoTurnLog } from "@morlay/dsh-session/testing";

const opened: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  cleanup();
  for (const item of opened.splice(0).reverse()) await item.dispose();
});

async function boot(id: string): Promise<{ host: Host; client: Client }> {
  const host = await startHost();
  opened.push(host);
  // 种子走**真会话**（不是直接写库）：内存 log 与库同源，投影检查点也才有可折的单元。
  const live = host.ctx.sessions.create(SessionId(id), {
    meta: meta(id, "/work"),
    seed: twoTurnLog(),
  });
  await host.ctx.sessions.flush(live);
  host.agentDirectory.attach(live);
  const client = await startClient(host.handlers);
  opened.push(client);
  return { host, client };
}

const seqsOf = (events: readonly { seq: unknown }[]): number[] =>
  events.map((event) => event.seq as number);

// 一条消息的第一个文本块（可选链只到终点，不做「取到就继续访问」）。
function firstTextOf(content: readonly unknown[] | undefined): string | undefined {
  const block = content?.[0] as { text?: string } | undefined;
  return block?.text;
}

describe("编辑：点编辑 → 撤回 → 改文本 → 提交", () => {
  it(
    "真库截到目标回合之前、草稿收到原文本；提交后新文本成为该回合的用户输入",
    { timeout: 60_000 },
    async () => {
      const { host, client } = await boot("edit-target");
      const before = await host.eventsOf("edit-target");
      // 第二个回合的 user/message（turnLog(6, 2) 的第三条事件）。
      const node = nodeOf(before, 8);
      const view = renderUserMessage({ node, face: client.store.faceOf("edit-target") });

      // ① 点「编辑」：先弹确认，确认后才发 wire。
      fireEvent.click(screen.getByLabelText("编辑"));
      fireEvent.click(screen.getByText("撤回并编辑"));

      // ② 库里的日志被截到**目标回合之前**：只剩第一个回合（seq 0..5）。
      const truncated = await waitFor(
        () => host.eventsOf("edit-target"),
        (events) => events.length === 6,
        "撤回没有把日志截到目标回合之前",
      );
      expect(seqsOf(truncated)).toEqual([0, 1, 2, 3, 4, 5]);

      // ③ 草稿收到该消息的全部文本块（撤回的下一步是改完再发）。
      expect(client.composer.drafts).toEqual([{ sessionId: "edit-target", text: "second turn" }]);
      // ④ 窗口重建走会话面自己的 resync（不整页重载）。
      expect(client.composer.resyncs).toEqual(["edit-target"]);

      // ⑤ 改文本 → 提交（上游 composer 的那一步；本包只负责截断 + 回填）。
      const agent = host.agentDirectory.get(SessionId("edit-target"));
      if (agent === undefined) throw new Error("活会话没有 agent：提交的那一步没人接");
      agent.followup({
        id: randomUUID(),
        role: "user",
        content: [{ type: "text", text: "改过的输入" }],
        source: { kind: "user" },
      } as never);

      const after = await waitFor(
        () => host.eventsOf("edit-target"),
        (events) => events.length === 12 && events.at(-1)?.type === "turn/end",
        "提交后没有落成新一轮",
      );
      // 新文本就是该回合的用户输入（读库）。
      const userEvent = after.find((event) => event.seq === 8);
      expect(userEvent?.type).toBe("user/message");
      const userContent =
        userEvent === undefined
          ? undefined
          : (userEvent.data as { content: readonly unknown[] }).content;
      expect(firstTextOf(userContent)).toBe("改过的输入");
      // 回复由（替身）模型生成，且落在同一回合里。
      const reply = after.at(-3);
      expect(reply?.type).toBe("assistant/message");
      const replyContent =
        reply === undefined
          ? undefined
          : (reply.data as { message: { content: readonly unknown[] } }).message.content;
      expect(firstTextOf(replyContent)).toBe(MOCK_REPLY_PREFIX + "改过的输入");

      view.unmount();
    },
  );
});

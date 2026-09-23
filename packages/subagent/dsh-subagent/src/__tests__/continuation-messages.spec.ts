import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { withContinuableReturnGuidance } from "../continuation-messages.ts";

const task: ContentBlock[] = [{ type: "text", text: "写一份简报" }];

function guidanceOf(blocks: ContentBlock[]): string {
  const [last] = blocks.slice(-1);
  if (last === undefined || last.type !== "text") throw new Error("guidance block is not text");
  return last.text;
}

/**
 * 本包唯一的行为契约：continuable 子代理的首条任务后面追加的回报指引是中文，
 * 且父代理 id、回报方式（send_message）、「回报不结束回合」这些要点一个不少。
 */
describe("withContinuableReturnGuidance", () => {
  it("在任务块之后追加中文回报指引", () => {
    const blocks = withContinuableReturnGuidance(SessionId("session-parent"), task);
    const guidance = guidanceOf(blocks);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(task[0]);
    expect(guidance).toContain('你的父智能体 id 是 "session-parent"');
    expect(guidance).toContain('send_message({ agent_id: "session-parent"');
    expect(guidance).toContain("不会自动收到你的对话、工具输出与推理过程");
    expect(guidance).toContain("发消息不会结束你的回合");
  });

  it("不带上游的英文指引", () => {
    const guidance = guidanceOf(withContinuableReturnGuidance(SessionId("session-parent"), task));

    expect(guidance).not.toContain("Your parent agent id is");
    expect(guidance).not.toContain("does not end your turn");
  });

  it("不改动传入的任务块，也不返回同一个数组", () => {
    const blocks = withContinuableReturnGuidance(SessionId("session-parent"), task);

    expect(task).toHaveLength(1);
    expect(blocks).not.toBe(task);
  });
});

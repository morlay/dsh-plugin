import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { localizedReturnGuidance, withResultDeliveryGuidance } from "../continuation-messages.ts";

const task: ContentBlock[] = [{ type: "text", text: "写一份简报" }];

function guidanceOf(blocks: ContentBlock[]): string {
  const [last] = blocks.slice(-1);
  if (last === undefined || last.type !== "text") throw new Error("guidance block is not text");
  return last.text;
}

// 本包唯一的行为契约：父代理派发的 continuable 子代理，首条任务后面追加的"回报方式"指引是中文。
// 上游 0.2.2-rc.2 把这段文案的语义换成"最终答案自动送达"（不再点名父代理 id 与 `send_message` 的调用形状），
// 中文版跟着同一份语义走，只换语言。
describe("withResultDeliveryGuidance", () => {
  it("在任务块之后追加中文回报指引", () => {
    const blocks = withResultDeliveryGuidance(task);
    const guidance = guidanceOf(blocks);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(task[0]);
    expect(guidance).toContain("你的最终答案会在父智能体仍在线时自动送达");
    expect(guidance).toContain("父智能体收不到你的完整对话、工具输出与推理过程");
    expect(guidance).toContain("完成通知会省略你的最终答案");
  });

  it("不带上游的英文指引", () => {
    const guidance = guidanceOf(withResultDeliveryGuidance(task));

    expect(guidance).not.toContain("Your final answer is delivered automatically");
    expect(guidance).not.toContain("the completion notice omits your final answer");
  });

  it("不改动传入的任务块，也不返回同一个数组", () => {
    const blocks = withResultDeliveryGuidance(task);

    expect(task).toHaveLength(1);
    expect(blocks).not.toBe(task);
  });
});

// 判据：名单不配（空）= 不限制，任意会话都用中文；配了才反过来收窄。
describe("localizedReturnGuidance", () => {
  it("没配名单：任意 preset（含还没绑 preset 的会话）都用中文", () => {
    expect(localizedReturnGuidance("standard", [])).toBe(true);
    expect(localizedReturnGuidance(undefined, [])).toBe(true);
  });

  it("配了名单：名单内的 preset 用中文，名单外的与还没绑 preset 的用上游英文", () => {
    expect(localizedReturnGuidance("ptc", ["ptc", "minimal"])).toBe(true);
    expect(localizedReturnGuidance("standard", ["ptc", "minimal"])).toBe(false);
    expect(localizedReturnGuidance(undefined, ["ptc"])).toBe(false);
  });
});

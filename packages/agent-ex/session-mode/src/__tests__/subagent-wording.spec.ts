// 两处文案的纯函数面：中文正文的要点、按 preset 的判定、上游英文的识别与替换。
import type { ContentBlock } from "@morlay/dsh-agent/contract";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { describe, expect, it } from "vitest";
import {
  DELEGATION_CONTEXT_NAME,
  DELEGATION_CONTEXT_TEXT,
  isDelegatedAgent,
  rewordedContext,
} from "@morlay/session-mode";
import {
  localizedGuidanceApplies,
  localizedReturnGuidanceText,
  rewordGuidanceContent,
  rewordReturnGuidance,
} from "@morlay/session-mode";

const UPSTREAM = (parentId: string): string =>
  `Your parent agent id is ${JSON.stringify(parentId)}. Before you finish, send your result to that agent ` +
  `with send_message({ agent_id: ${JSON.stringify(parentId)}, message: "<self-contained result>" }). The ` +
  "parent shares your workspace but does not automatically receive your transcript, tool output, or " +
  "reasoning. Send earlier messages as well when a finding changes what the parent should do next; " +
  "sending a message does not end your turn.";

describe("中文回报指引的正文", () => {
  it("父 id、用什么回报、父看不到什么、回报不结束回合，一个不少", () => {
    const text = localizedReturnGuidanceText("parent-1");

    expect(text).toContain('你的父智能体 id 是 "parent-1"');
    expect(text).toContain('send_message({ agent_id: "parent-1"');
    expect(text).toContain("不会自动收到你的对话、工具输出与推理过程");
    expect(text).toContain("发消息不会结束你的回合");
  });
});

describe("按 preset 决定用哪份文案", () => {
  it("名单留空 = 不限：任意 preset 与没绑 preset 的会话都用中文", () => {
    expect(localizedGuidanceApplies(undefined, [])).toBe(true);
    expect(localizedGuidanceApplies("standard", [])).toBe(true);
  });

  it("配了名单就收窄：名单内用中文，名单外与没绑 preset 的保持上游", () => {
    expect(localizedGuidanceApplies("mode-switch", ["mode-switch"])).toBe(true);
    expect(localizedGuidanceApplies("standard", ["mode-switch"])).toBe(false);
    expect(localizedGuidanceApplies(undefined, ["mode-switch"])).toBe(false);
  });
});

describe("上游英文指引的替换", () => {
  it("认出上游那条并换成中文（父 id 原样带过来）", () => {
    const text = rewordReturnGuidance(UPSTREAM("parent-2"));

    expect(text).toContain('你的父智能体 id 是 "parent-2"');
    expect(text).not.toContain("Your parent agent id is");
  });

  it("不是那条就不动（宁可留英文，也不注错父 id）", () => {
    expect(rewordReturnGuidance("普通消息")).toBeUndefined();
    expect(rewordReturnGuidance("Your parent agent id is unknown.")).toBeUndefined();
  });

  it("消息正文里命中才换，其余块原样", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "写一份简报" },
      { type: "text", text: UPSTREAM("parent-3") },
    ];
    const reworded = rewordGuidanceContent(content);

    expect(reworded?.[0]).toBe(content[0]);
    expect(reworded).toBeDefined();
    const guidance = reworded?.[1] as { text: string } | undefined;
    expect(guidance?.text).toContain('你的父智能体 id 是 "parent-3"');
    // 没命中给 undefined：调用方据此判定"这条消息别动"。
    expect(rewordGuidanceContent([{ type: "text", text: "写一份简报" }])).toBeUndefined();
  });
});

describe("委派范围说明", () => {
  it("中文那条讲清固定权限、自动拒绝与说明限制", () => {
    expect(DELEGATION_CONTEXT_TEXT).toContain("权限范围在创建时就固定");
    expect(DELEGATION_CONTEXT_TEXT).toContain("一律被自动拒绝");
    expect(DELEGATION_CONTEXT_TEXT).toContain("让派发你的智能体处理");
  });

  it("只有同名那条换文本，别的上下文原样", () => {
    const other = {
      name: "context:file-reference",
      text: "以 @ 开头的词是用户显式引用的工作区路径。",
    };
    expect(rewordedContext(other)).toBe(other);
    expect(rewordedContext({ name: DELEGATION_CONTEXT_NAME, text: "上游英文" }).text).toBe(
      DELEGATION_CONTEXT_TEXT,
    );
  });

  it("子代理的判据是会话头的 parentSession", () => {
    const withParent = { session: { header: { parentSession: SessionId("p") } } } as never;
    const root = { session: { header: {} } } as never;

    expect(isDelegatedAgent(withParent)).toBe(true);
    expect(isDelegatedAgent(root)).toBe(false);
    expect(isDelegatedAgent(undefined)).toBe(false);
  });
});

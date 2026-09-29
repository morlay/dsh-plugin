// @vitest-environment jsdom
// composer 里那个模式 chip 的两种形态：空白会话是选择器（点开有清单），开过 turn 之后只读（只显示当前模式）。
// 判据来自 host 的投影 `sessionModeEditable`，与服务端拒绝切换用的是同一份事实。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionModeRoster } from "../shared.ts";
import { SessionModeSeat, type SessionModeSeatProps } from "../client/SessionModeSeat.tsx";

const ROSTER: SessionModeRoster = {
  default: "coding",
  modes: [
    { id: "coding", name: "编码模式", description: "编码" },
    { id: "chat", name: "对话模式", description: "对话" },
  ],
};

// 槽位 props 里本组件真正用到的三个：会话 id、会话状态读面、字典。
function propsFor(projectionValues: Readonly<Record<string, unknown>>): SessionModeSeatProps {
  return {
    sessionId: "session-1",
    useSessions: (selector: (state: unknown) => unknown) =>
      selector({ byId: { "session-1": { projectionValues } } }),
    t: (key: string) => key,
  } as SessionModeSeatProps;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(ROSTER), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  // 本仓库的 vitest 没开 globals，testing-library 不会自己清：不清就会查到上一个用例的 chip。
  cleanup();
  vi.unstubAllGlobals();
});

// 清单是异步读来的：等到 chip 的按钮出现再断言。
async function chip(): Promise<HTMLElement> {
  return await screen.findByRole("button");
}

describe("composer 里的模式 chip", () => {
  it("空白会话：是选择器（点得开，带下拉面）", async () => {
    render(<SessionModeSeat {...propsFor({ sessionMode: "coding", sessionModeEditable: true })} />);

    const button = await chip();

    expect(button.textContent).toContain("编码模式");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("开过 turn 的会话：只读——只写当前模式，点不动", async () => {
    render(
      <SessionModeSeat {...propsFor({ sessionMode: "coding", sessionModeEditable: false })} />,
    );

    const button = await chip();

    expect(button.textContent).toContain("编码模式");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    expect(button.getAttribute("title")).toBe("lockedHint");
  });
});

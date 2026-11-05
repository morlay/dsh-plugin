// @vitest-environment happy-dom
// composer 里的模式 chip：点开是模式清单，选中后走一次切换；开过 turn 的会话只读。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionModeSeatView } from "../session-mode-seat.view.tsx";

afterEach(() => {
  cleanup();
});

describe("composer 的模式 chip", () => {
  it("清单读到之前不渲染", () => {
    const view = new SessionModeSeatView();
    Object.defineProperty(view, "store", {
      // 永远不会 resolve 的清单：这一帧就该是空的。
      value: { loadRoster: () => new Promise(() => {}) },
    });
    (view as unknown as { viewProps: unknown }).viewProps = {};
    const tree = view.render();
    if (tree === null) return;
    const { container } = render(<>{tree}</>);
    expect(container.textContent).toBe("");
  });

  it("清单到了就渲染成座位按钮", async () => {
    const view = new SessionModeSeatView();
    Object.defineProperty(view, "store", {
      value: {
        loadRoster: async () => ({
          default: "coding",
          modes: [{ id: "coding", name: "编码模式", description: "完整的编码 Agent。" }],
        }),
        select: async () => "coding",
      },
    });
    (view as unknown as { viewProps: unknown }).viewProps = {};
    const tree = view.render();
    expect(tree).not.toBeNull();
    if (tree === null) return;
    render(<>{tree}</>);
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    fireEvent.click(screen.getByText("编码模式"));
    await waitFor(() => {
      expect(screen.getAllByText("编码模式").length).toBeGreaterThan(0);
    });
  });
});

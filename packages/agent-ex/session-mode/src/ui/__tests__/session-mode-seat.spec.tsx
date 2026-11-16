// @vitest-environment happy-dom
// composer 里的模式 chip：点开是模式清单，选中后走一次切换；开过 turn 的会话只读。
// 只读态与当前选中都读**会话投影**（`sessionModeEditable` / `sessionMode`），与宿主拒绝切换读同一份事实。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { zh } from "../locales.ts";
import { SessionModeSeatView } from "../session-mode-seat.view.tsx";

afterEach(() => {
  cleanup();
});

// 会话目录快照的形状（上游 `useSessions` 的 selector 入参）：本包只读 `projectionValues`。
interface CatalogSnapshot {
  byId: Record<string, { projectionValues?: Record<string, unknown> }>;
}

/** 一个把投影值直接喂给 selector 的 `useSessions` 替身。 */
function sessionsWith(values: Record<string, unknown>) {
  const snapshot: CatalogSnapshot = { byId: { s1: { projectionValues: values } } };
  return (selector: (state: CatalogSnapshot) => unknown): unknown => selector(snapshot);
}

// 清单一到就能渲染的两个模式。
const ROSTER = {
  default: "coding",
  modes: [
    { id: "coding", name: "编码模式", description: "完整的编码 Agent。" },
    { id: "chat", name: "对话模式", description: "只做对话。" },
  ],
};

/** 装配一个 chip 容器：store 与字典都换成替身（装配里那两样由装配提供）。 */
function seatView(options: {
  readonly store: unknown;
  readonly props?: Record<string, unknown>;
}): SessionModeSeatView {
  const view = new SessionModeSeatView();
  Object.defineProperty(view, "store", { value: options.store });
  Object.defineProperty(view, "locales", {
    value: { t: () => (key: keyof typeof zh) => zh[key] },
  });
  (view as unknown as { viewProps: unknown }).viewProps = options.props ?? {};
  return view;
}

describe("composer 的模式 chip", () => {
  it("清单读到之前不渲染", () => {
    const view = seatView({
      // 永远不会 resolve 的清单：这一帧就该是空的。
      store: { loadRoster: () => new Promise(() => {}) },
    });
    const tree = view.render();
    if (tree === null) return;
    const { container } = render(<>{tree}</>);
    expect(container.textContent).toBe("");
  });

  it("清单到了就渲染成座位按钮", async () => {
    const view = seatView({
      store: {
        loadRoster: async () => ROSTER,
        select: async () => "coding",
      },
    });
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

  it("投影说不可改时渲染只读并给原因", async () => {
    // 会话已经开了 turn：投影 `sessionModeEditable` 是 false（不是本地 state 猜的）。
    const view = seatView({
      store: { loadRoster: async () => ROSTER, select: async () => "chat" },
      props: { sessionId: "s1", useSessions: sessionsWith({ sessionModeEditable: false }) },
    });
    const tree = view.render();
    if (tree === null) throw new Error("chip 没渲染");
    const { container } = render(<>{tree}</>);
    // 清单读回来之前 chip 是空的（只读形态也要等清单，否则没有模式名可显示）。
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDefined();
    });
    // 只读形态：一个点不动的座位，标题就是原因（没有菜单可开）。
    const locked = container.querySelector('[data-role="session-mode-seat"]');
    expect(locked?.getAttribute("data-locked")).toBe("true");
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("这个会话已经开始：换模式请新开一个会话");
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    // 原因是字典里的那一句，不是硬编码。
    expect(button.getAttribute("title")).toBe(zh.lockedHint);
  });

  it("失败后错误条在 DOM 里", async () => {
    const view = seatView({
      store: {
        loadRoster: async () => ROSTER,
        select: async () => {
          throw new Error("这个会话已经开始");
        },
      },
      props: { sessionId: "s1", useSessions: sessionsWith({ sessionMode: "coding" }) },
    });
    const tree = view.render();
    if (tree === null) throw new Error("chip 没渲染");
    render(<>{tree}</>);
    await waitFor(() => {
      expect(screen.getByText("编码模式")).toBeDefined();
    });
    // 打开清单、选另一个模式：这一步失败。
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("对话模式")).toBeDefined();
    });
    fireEvent.click(screen.getByText("对话模式"));
    // 错误不能只挂在 tooltip 上：DOM 里得有一条看得见的错误条。
    await waitFor(() => {
      expect(document.querySelector('[data-role="seat-error"]')).not.toBeNull();
    });
    const error = document.querySelector('[data-role="seat-error"]');
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent).toContain(zh.seatFailed);
    expect(error?.textContent).toContain("这个会话已经开始");
  });
});

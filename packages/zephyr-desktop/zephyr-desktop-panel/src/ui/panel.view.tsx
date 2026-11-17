// 右栏的浏览器面板：**地址栏在页面里，网页容器在主进程里**。
//
// 分工（设计决定 1 / 3 / 8）：
// - 这里只画地址栏、按钮与一块**占位矩形**；真正的网页是壳主进程的 `WebContentsView`，盖在这块矩形上；
// - 导航只发意图（`navigate`），白名单在主进程；`state` 只有主进程推，这里不自己推导；
// - 矩形变化（挂载 / 缩放 / 右栏开合）就报给主进程，它照着摆；
// - 卸载（关 tab）与窗口关闭都 `close`：view 要销毁，不残留 webContents。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Slots } from "@morlay/zephyr-app/client";
import { browserPaneOf, panelBoundsOf, type PaneState } from "./panel-bridge.ts";
import { PANEL_ID } from "./panel-slots.ts";

const BAR_STYLE = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "8px 12px",
  boxSizing: "border-box",
} as const;

/** 面板正文（纯展示 + 桥的调用；测试直接渲染它）。 */
export function DesktopPanelBody(props: {
  readonly bridge?: ReturnType<typeof browserPaneOf>;
}): ReactNode {
  const { bridge } = props;
  const host = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState("");
  const [state, setState] = useState<PaneState | undefined>(undefined);
  const [reason, setReason] = useState<string | undefined>(undefined);

  // 状态只有一条来源：主进程推来的那一份；卸载时退订。
  useEffect(() => {
    if (bridge === undefined) return;
    const off = bridge.subscribe((change) => {
      if (change.id !== PANEL_ID) return;
      setState(change.state);
      if (change.state !== undefined) setAddress(change.state.url);
    });
    return () => {
      off();
    };
  }, [bridge]);

  // 开与关都跟着这一块走：挂上就开（view 由主进程建），卸下就关（销毁 webContents）。
  useEffect(() => {
    if (bridge === undefined) return;
    const bounds = panelBoundsOf(host.current);
    if (bounds === undefined) return;
    void bridge.open({ id: PANEL_ID, bounds });
    return () => {
      void bridge.close(PANEL_ID);
    };
  }, [bridge]);

  // 矩形跟随：挂载、缩放、右栏开合都会改变它。
  useEffect(() => {
    if (bridge === undefined) return;
    const push = (): void => {
      const bounds = panelBoundsOf(host.current);
      if (bounds !== undefined) void bridge.bounds(PANEL_ID, bounds);
    };
    push();
    const observer = new ResizeObserver(push);
    if (host.current !== null) observer.observe(host.current);
    window.addEventListener("resize", push);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", push);
    };
  }, [bridge]);

  const go = (): void => {
    if (bridge === undefined) return;
    void bridge.navigate(PANEL_ID, address).then((result) => {
      const rejected = result as { ok?: boolean; reason?: string };
      setReason(rejected.ok === false ? (rejected.reason ?? "打不开这个地址") : undefined);
    });
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <form
        style={BAR_STYLE}
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <input
          aria-label="地址"
          value={address}
          placeholder="https://"
          onChange={(event) => {
            setAddress(event.target.value);
          }}
          style={{ flex: 1 }}
        />
        <button type="submit">打开</button>
      </form>
      <div style={{ padding: "0 12px", minHeight: "20px" }}>
        <span style={{ opacity: 0.7 }}>
          {reason ?? (state?.loading === true ? "加载中…" : (state?.title ?? ""))}
        </span>
      </div>
      {/* 占位矩形：主进程的网页容器盖在这里（页面里看不到内容，看到的是原生 view）。 */}
      <div ref={host} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

/**
 * 右栏的浏览器面板（位置上的那一页）。
 *
 * **不声明 slot**：位置 `sidebar.right.pane.tab` 的声明权归 tab 机制，本包只贡献自己那个 key 的视图——
 * 声明两次会得到 `service "sidebar.right.pane.tab" has been registered`（真实现场：整页装配失败）。
 */
@Injectable()
export class DesktopPanelView implements OnInit {
  private readonly slots = inject(Slots);

  private off: (() => void) | undefined;

  onInit(): void {
    this.off = this.slots.registerDynamic(
      { name: "sidebar.right.pane.tab", key: PANEL_ID },
      () => <DesktopPanelBody bridge={browserPaneOf()} />,
    );
  }

  onDispose(): void {
    this.off?.();
  }
}

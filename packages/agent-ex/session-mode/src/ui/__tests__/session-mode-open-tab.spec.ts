// 判据 17：会话切换且右栏已经挂到那个会话 → `sidebarRight.openTab(PANEL_ID)` 恰好一次。
//
// 两路信号是上游行按**名字**发布的服务面（`uiSession` / `sidebarRight`），替身只在这一层：
// 用值条目把面交进去，被测的订阅与合并逻辑是真的（真 `bootstrapApplication` 装配）。
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { SidebarRight, UiSession } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { SessionModeFollowPanel } from "../session-mode.provide.ts";
import { PANEL_ID } from "../session-mode-slots.ts";

// 一条快照源：用例里手动推值与通知（与上游 `HostObservable` 同形）。
interface Signal<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

interface MutableSignal<T> extends Signal<T> {
  set(value: T): void;
}

function signalOf<T>(initial: T): MutableSignal<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

interface Harness {
  // 用户切到了哪个会话（`uiSession.adapter.current` 的绑定快照，`key` 就是会话 id）。
  readonly current: MutableSignal<{ key?: string }>;
  // 右栏挂到了哪个会话。
  readonly mounted: MutableSignal<string | undefined>;
  // `openTab` 被调过的 kind（按调用顺序）。
  readonly opened: string[];
}

const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose();
});

/** 装配一条只含「跟随」行的应用；返回两路信号与调用记录。 */
async function mountFollow(): Promise<Harness> {
  const current = signalOf<{ key?: string }>({});
  const mounted = signalOf<string | undefined>(undefined);
  const opened: string[] = [];
  const app = await bootstrapApplication({
    providers: [
      { provide: UiSession as unknown as object, useValue: { adapter: { current } } },
      {
        provide: SidebarRight as unknown as object,
        useValue: {
          mounted,
          openTab: (kind: string) => {
            opened.push(kind);
          },
        },
      },
      SessionModeFollowPanel,
    ],
  } as never);
  apps.push(app);
  return { current, mounted, opened };
}

// 让 `queueMicrotask` 与订阅回调都跑完。
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("会话切换联动右栏面板", () => {
  it("切到新会话后 openTab 被调一次", async () => {
    const h = await mountFollow();
    await settle();
    // 首帧：没有任何会话，什么都不开。
    expect(h.opened).toEqual([]);

    // 会话先换、右栏后挂（真机的顺序）：中间那一帧不该开。
    h.current.set({ key: "s1" });
    await settle();
    expect(h.opened).toEqual([]);

    h.mounted.set("s1");
    await settle();
    // 两路都指到同一个会话：恰好一次。
    expect(h.opened).toEqual([PANEL_ID]);

    // 同一个会话的重复通知（右栏内部重挂、列表刷新）不再开。
    h.mounted.set("s1");
    h.current.set({ key: "s1" });
    await settle();
    expect(h.opened).toEqual([PANEL_ID]);

    // 换到另一个会话：右栏跟过去之后又是一次。
    h.current.set({ key: "s2" });
    h.mounted.set("s2");
    await settle();
    expect(h.opened).toEqual([PANEL_ID, PANEL_ID]);
  });
});

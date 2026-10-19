// @vitest-environment happy-dom
// 「位置声明 → `inject` 就地注册」这条链的闭环：上游的父行用
// `register({ children })` 声明位置族，子行用 `slots.inject(name, () => register(...))` 挂进来。
//
// 侧栏没有会话树（`sidebar.workspaces` 空）时就是这条链断了：`inject` 的 reconcile 读
// `core.specDynamic(key)`，位置没声明就直接返回，而**它不报错**——表现只有"渲染空"。
// 所以这里直接断言：声明之后 `inject` 必须真的把贡献装进去。
import { Logger, bootstrapApplication, type App } from "@morlay/zephyr";
import { Slots, provideRenderer } from "@morlay/zephyr-app/client";
import { Injectable } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

/** 一条空的占位组件（本 spec 只看账本，不渲染）。 */
const Blank = (): null => null;

/** 日志替身：记下所有 warn（本 spec 断言的就是"失败必须留痕"）。 */
@Injectable()
class RecordingLogger extends Logger {
  readonly warns: string[] = [];

  error(): void {}

  warn(...args: unknown[]): void {
    this.warns.push(args.map(String).join(" "));
  }

  info(): void {}

  debug(): void {}
}

/**
 * 只装渲染面（`Slots` 的实现）+ 日志替身。
 * @returns app 与 slot 账本。
 */
async function boot(): Promise<{ app: App; slots: Slots }> {
  const app = await bootstrapApplication({
    providers: [...provideRenderer(), { provide: Logger, useFactory: () => new RecordingLogger() }],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return { app, slots: app.get(Slots) };
}

describe("位置声明与 inject 注册", () => {
  it("父行声明 children 后，子行的 `inject` 会就地注册", async () => {
    const { slots } = await boot();
    const declared = slots.register(
      { name: "root", children: { sidebar: { kind: "single", scope: "root" } } } as never,
      Blank as never,
    );

    let registered = 0;
    const undo = slots.inject("sidebar" as never, () => {
      registered += 1;
      return () => {};
    });
    expect(registered, "位置声明之后 `inject` 必须触发一次").toBe(1);

    // 父行撤销注册（位置塌掉）时贡献也应跟着撤：本 spec 只断言"装过一次"，撤销路径由上游 `inject` 保证。
    declared();
    expect(registered).toBe(1);
    undo();
  });

  it("位置没声明时 `inject` 不触发，但卸载时**必须**留下一条 warn（不静默）", async () => {
    const { app, slots } = await boot();
    const logged = app.get(Logger);
    expect(logged).toBeInstanceOf(RecordingLogger);
    let registered = 0;
    const undo = slots.inject("sidebar.workspaces" as never, () => {
      registered += 1;
      return () => {};
    });
    expect(registered).toBe(0);
    undo();
    expect((logged as RecordingLogger).warns).toEqual([expect.stringContaining("位置 \"sidebar.workspaces\" 从未被声明")]);
  });
});

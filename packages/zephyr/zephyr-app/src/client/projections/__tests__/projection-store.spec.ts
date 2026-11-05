// `ProjectionValueStore` 的**语义闭环**：sequenced / cached / seed 三条规则。
//
// 这三条是上游 `ProjectionValueStore` 的全部约定，界面"文案不动 / 偶发回退"几乎都出在这里：
//   - 高 seq 胜（重放帧与旧帧不能盖新值）；
//   - cached 行（`session/list` 那一瞥）永远让位给 sequenced 行；
//   - `seed(baseline)` 先丢 cached、再按 seq 落值、最后清掉基线没有的键（但不清更新的）。
import { describe, expect, it } from "vitest";
import { ProjectionValueStore } from "../projection-store.ts";

/** 一次性读出某个键的值（同步，store 内部直接读行）。 */
function valueOf(store: ProjectionValueStore, key: string): unknown {
  return store.faceOf(key).getSnapshot();
}

describe("ProjectionValueStore", () => {
  it("sequenced：高 seq 胜，重放与旧帧都丢掉", () => {
    const store = new ProjectionValueStore();
    store.apply("permissions", { currentValue: "workspace-write" }, 5);
    expect(valueOf(store, "permissions")).toEqual({ currentValue: "workspace-write" });

    store.apply("permissions", { currentValue: "danger-full-access" }, 9);
    expect(valueOf(store, "permissions")).toEqual({ currentValue: "danger-full-access" });

    // 旧帧重放：不能把值退回去。
    store.apply("permissions", { currentValue: "workspace-write" }, 6);
    expect(valueOf(store, "permissions")).toEqual({ currentValue: "danger-full-access" });
    // 相同 seq 也不覆盖（同一水位上先到的那个算数）。
    store.apply("permissions", { currentValue: "read-only" }, 9);
    expect(valueOf(store, "permissions")).toEqual({ currentValue: "danger-full-access" });
    expect(store.seqOf("permissions")).toBe(9);
  });

  it("cached：只填没有 sequenced 行的键，且任何 sequenced 写入都能盖掉它", () => {
    const store = new ProjectionValueStore();
    store.applyCached({ permissions: { currentValue: "read-only" }, title: "会话" });
    expect(valueOf(store, "permissions")).toEqual({ currentValue: "read-only" });
    expect(store.seqOf("permissions"), "cached 没有可比水位").toBeUndefined();

    store.apply("permissions", { currentValue: "workspace-write" }, 1);
    expect(valueOf(store, "permissions")).toEqual({ currentValue: "workspace-write" });

    // 之后再来 cached（列表刷新）不能把 sequenced 的值盖掉。
    store.applyCached({ permissions: { currentValue: "read-only" }, title: "旧标题" });
    expect(valueOf(store, "permissions")).toEqual({ currentValue: "workspace-write" });
    // `title` 仍是 cached，可以更新。
    expect(valueOf(store, "title")).toBe("旧标题");
  });

  it("seed：先丢 cached、按 seq 落值、清掉基线没有的键（不清更新的）", () => {
    const store = new ProjectionValueStore();
    store.applyCached({ title: "cached 标题", permissions: { currentValue: "read-only" } });
    store.apply("modelSelection", { provider: "p", model: "m" }, 20);

    // 基线水位 10：比它更新的 `modelSelection`（20）必须留住。
    store.seed({ asOfSeq: 10, values: { permissions: { currentValue: "workspace-write" } } });

    expect(valueOf(store, "permissions"), "基线覆盖 cached 的键").toEqual({ currentValue: "workspace-write" });
    expect(valueOf(store, "title"), "cached 行被基线整体丢弃").toBeUndefined();
    expect(valueOf(store, "modelSelection"), "比基线更新的 sequenced 行不被清").toEqual({
      provider: "p",
      model: "m",
    });
  });

  it("face 是 identity-stable 的，订阅者在变化后收到通知", { timeout: 5_000 }, async () => {
    const store = new ProjectionValueStore();
    const first = store.faceOf("permissions");
    expect(store.faceOf("permissions"), "同一个键只给一个 face").toBe(first);

    let notified = 0;
    const off = first.subscribe(() => {
      notified += 1;
    });
    store.apply("permissions", { currentValue: "read-only" }, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(notified, "写入后订阅者必须收到通知").toBe(1);
    off();
    store.apply("permissions", { currentValue: "read-only" }, 2);
    await Promise.resolve();
    await Promise.resolve();
    expect(notified, "退订后不再通知").toBe(1);
  });

  it("values() 引用稳定；clear() 清值但保留 face", () => {
    const store = new ProjectionValueStore();
    const face = store.faceOf("title");
    store.apply("title", "标题", 1);
    const first = store.values();
    expect(store.values(), "行没变就是同一个对象").toBe(first);

    store.clear();
    expect(store.values()).toEqual({});
    expect(valueOf(store, "title"), "face 还在，只是值没了").toBeUndefined();
    expect(store.faceOf("title"), "订阅面不因 clear 重建").toBe(face);
  });
});

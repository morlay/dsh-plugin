/**
 * `createShim`：把「同步 storage 接口」和「异步后端」接起来的那个适配器。
 *
 * 三组判据：
 * 1. **同步语义**：写入立刻读得到（`getItem` / `length` / `key` / 删除 / 清空）——上游代码按同步 `Storage` 用；
 * 2. **写入被刷出去**：每次变更都按顺序交给注入的 writer，删除与清空发 `value: null`；
 * 3. **不共享初值**：入参那份表是快照，shim 自己的改动不回流。
 *
 * 这里不碰 IndexedDB：后端是注入的假 writer（真链路里是 `createWriter(db, store)`）。
 */
import { describe, expect, it } from "vitest";
import { createShim, drainNative, installStorageShim, type PendingWrite } from "../storage-shim.ts";

describe("createShim", () => {
  it("写入立刻读得到：getItem / length / key / removeItem / clear", () => {
    const shim = createShim(new Map([["a", "1"]]), () => {});
    expect(shim.length).toBe(1);
    expect(shim.key(0)).toBe("a");
    expect(shim.key(1)).toBeNull();
    expect(shim.getItem("a")).toBe("1");
    expect(shim.getItem("missing")).toBeNull();

    shim.setItem("b", "2");
    expect(shim.getItem("b")).toBe("2");
    expect(shim.length).toBe(2);

    shim.removeItem("a");
    expect(shim.getItem("a")).toBeNull();
    expect(shim.key(0)).toBe("b");

    shim.clear();
    expect(shim.length).toBe(0);
    expect(shim.key(0)).toBeNull();
  });

  it("每次写都按顺序刷给注入的 writer，删除与清空发 value: null", () => {
    const writes: PendingWrite[] = [];
    const shim = createShim(new Map([["a", "1"], ["b", "2"]]), (write) => writes.push(write));

    shim.setItem("c", "3");
    shim.removeItem("a");
    shim.clear();

    expect(writes).toEqual([
      { key: "c", value: "3" },
      { key: "a", value: null },
      // `clear()` 对**当前还在表里的**每个键各发一条（`a` 已被上一步删掉，故不再出现）。
      { key: "b", value: null },
      { key: "c", value: null },
    ]);
  });

  it("初值是快照：shim 的写入不会回流到入参那张表", () => {
    const initial = new Map([["a", "1"]]);
    const shim = createShim(initial, () => {});
    shim.setItem("b", "2");
    expect(initial.has("b")).toBe(false);
    expect(shim.getItem("a")).toBe("1");
  });
});

/** 假的原生 `Storage`：只有 `length` / `key` / `getItem`（`drainNative` 只读这三个）。 */
function fakeNativeStorage(
  entries: readonly (readonly [string, string])[],
  unreadable?: string,
): Storage {
  const map = new Map(entries);
  const keys = [...map.keys()];
  return {
    get length(): number {
      return map.size;
    },
    key: (index: number): string | null => keys[index] ?? null,
    getItem: (key: string): string | null => (key === unreadable ? null : (map.get(key) ?? null)),
    setItem: (): void => {},
    removeItem: (): void => {},
    clear: (): void => {},
  };
}

describe("drainNative（把原生 storage 的键搬进内存表）", () => {
  it("搬全部可读键，跳过 `getItem` 为 null 的项", () => {
    // `b` 的 key 还在、值读不到：模拟「值被清掉」的边界。
    expect(drainNative(fakeNativeStorage([["a", "1"], ["b", "2"]], "b"))).toEqual(new Map([["a", "1"]]));
  });

  it("原生为空时是空表", () => {
    expect(drainNative(fakeNativeStorage([])).size).toBe(0);
  });
});

describe("installStorageShim 的兜底", () => {
  it("没有 `indexedDB` 时不装、如实返回原因（调用方保留原生 storage）", { timeout: 10_000 }, async () => {
    const factory = globalThis.indexedDB;
    // happy-dom 里本来就没有 IDB；显式断言这个前提，避免用例在别的环境里变成「其实装了」。
    Reflect.deleteProperty(globalThis, "indexedDB");
    try {
      await expect(installStorageShim()).resolves.toEqual({ installed: false, reason: "indexedDB 不可用" });
    } finally {
      if (factory !== undefined) Reflect.set(globalThis, "indexedDB", factory);
    }
  });
});

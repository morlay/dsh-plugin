import { describe, expect, it } from "vitest";
import { layoutOf } from "../layout.ts";

describe("产物布局", () => {
  it("三样可整体删除的东西收进 node_modules/.zephyr", () => {
    const layout = layoutOf("/w");
    expect(layout.root).toBe("/w/node_modules/.zephyr");
    expect(layout.dist).toBe("/w/node_modules/.zephyr/dist");
    expect(layout.runtime).toBe("/w/node_modules/.zephyr/runtime");
    expect(layout.cache).toBe("/w/node_modules/.zephyr/cache");
    expect(layout.entry).toBe("/w/node_modules/.zephyr/runtime/entry.mjs");
  });

  it("配置可以换产物根", () => {
    expect(layoutOf("/w", "out").root).toBe("/w/out");
    expect(layoutOf("/w", "/abs/out").root).toBe("/abs/out");
  });
});

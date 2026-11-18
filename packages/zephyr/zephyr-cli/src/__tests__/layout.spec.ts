import { describe, expect, it } from "vitest";
import { layoutOf } from "../layout.ts";

describe("产物布局", () => {
  it("缺省落 target/<应用名>，五样东西各有其位", () => {
    const layout = layoutOf("/w", undefined, "Zephyr Custom");
    expect(layout.root).toBe("/w/target/Zephyr Custom");
    expect(layout.clientModules).toBe("/w/target/Zephyr Custom/client_modules");
    expect(layout.nodeModules).toBe("/w/target/Zephyr Custom/node_modules");
    expect(layout.serverEntry).toBe("/w/target/Zephyr Custom/src/server.ts");
    expect(layout.bootstrap).toBe("/w/target/Zephyr Custom/bootstrap.mjs");
    expect(layout.manifest).toBe("/w/target/Zephyr Custom/package.json");
  });

  it("没给应用名就用工作区目录名", () => {
    expect(layoutOf("/w/my-app").root).toBe("/w/my-app/target/my-app");
  });

  it("server.outputDir 换产物根（相对配置文件或绝对）", () => {
    expect(layoutOf("/w", "out", "Demo").root).toBe("/w/out");
    expect(layoutOf("/w", "/abs/out", "Demo").root).toBe("/abs/out");
  });

  it("旧的 dist / runtime / entry / cache 不再是布局的一部分（可分发的一份应用里没有它们）", () => {
    const layout = layoutOf("/w", undefined, "Demo");
    for (const gone of ["dist", "runtime", "entry", "cache"]) {
      // 「不再是布局的一部分」= 连键都没有（比「值为 undefined」更强）。
      expect(Object.hasOwn(layout, gone), gone).toBe(false);
    }
  });
});

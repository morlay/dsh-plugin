import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseFederationUrl } from "@morlay/zephyr-app/testing";

/**
 * `federation` 的用例矩阵（fixtures 就是 `__tests__/fixtures` 下的真实包）：
 *
 * - 行包（ESM + `exports`）：走 `exportTargetOf` → rolldown 产物 → `.js`
 * - 三方 CJS（`main: index.js`、子路径 `jsx-dev-runtime`）：同样由 rolldown 转成 ESM
 * - 未命中：`serve` 返回 404（不再静默回空模块）
 */
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

describe("parseFederationUrl（fixtures 的地址形态）", () => {
  it("行包：scope 名编码成 +，版本用清单里的", () => {
    expect(parseFederationUrl("/_zephyr/@modules/fixture-row@2.0.0/client")).toEqual({
      name: "fixture-row",
      urlVersion: "2.0.0",
      file: "client",
    });
  });

  it("三方子路径：`jsx-dev-runtime` 也是这条链的出口", () => {
    expect(parseFederationUrl("/_zephyr/@modules/fixture-cjs@1.0.0/jsx-dev-runtime.js")).toEqual({
      name: "fixture-cjs",
      urlVersion: "1.0.0",
      file: "jsx-dev-runtime.js",
    });
  });

  it("非本链地址返回 undefined", () => {
    expect(parseFederationUrl("/@vite/client")).toBeUndefined();
    expect(parseFederationUrl("/_zephyr/@modules/fixture-row")).toBeUndefined();
  });
});

describe("fixtures 的清单形状（覆盖不同用例的前提）", () => {
  it("行包有 exports 与 dsh.client", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "node_modules", "fixture-row", "package.json"), "utf8"));
    expect(manifest.exports["./client-module"]).toBe("./src/client.ts");
    expect(manifest.dsh.client.platform).toBe("web");
  });

  it("三方包是 CJS，且子路径是独立文件", async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURES, "node_modules", "fixture-cjs", "package.json"), "utf8"));
    expect(manifest.main).toBe("index.js");
    const dev = await readFile(join(FIXTURES, "node_modules", "fixture-cjs", "jsx-dev-runtime.js"), "utf8");
    expect(dev).toContain("jsxDEV");
  });
});

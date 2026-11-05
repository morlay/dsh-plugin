// 包出口的形状：**不按运行环境分面**——DSL 与装配内核是同一份，浏览器里 cordis 是合法运行期。
//
// 为什么钉这一条：本包不按运行环境分面——两端的装配入口调的是同一个 bootstrapApplication，
// 按端分面只会把同一份内核列两遍。
//
// 四条判据：
// 1. package.json 的 exports 只有 . / ./compat / ./testing（没有按运行环境分的面）；
// 2. 装配内核与 DSL 同在一个入口：包根同时导出 bootstrapApplication 与 inject / Injectable / EventEmitter / provide；
// 3. 适配面仍在 ./compat：fromCordis / toCordis 不在包根（分层不变）；
// 4. 三个入口与 tsdown.config.ts 的 entry 同名。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as compatFace from "../compat/index.ts";
import * as rootFace from "../index.ts";

/** 本包根（本文件在 src/__tests__/ 下）。 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * 读 package.json 的发布出口键。
 * @returns 出口键（去掉 ./package.json）。
 */
async function exportKeys(): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
    exports?: Record<string, string>;
  };
  return Object.keys(manifest.exports ?? {}).filter((key) => key !== "./package.json");
}

/**
 * 读 tsdown.config.ts 的 entry 列表。
 * @returns 入口源文件路径（相对包根）。
 */
async function buildEntries(): Promise<string[]> {
  const config = await readFile(join(packageRoot, "tsdown.config.ts"), "utf8");
  const opening = config.indexOf("entry: [");
  const body = config.slice(opening + "entry: [".length, config.indexOf("]", opening));
  return body
    .split(",")
    .map((part) => part.trim().split('"').join(""))
    .filter((part) => part !== "");
}

describe("包出口（@morlay/zephyr）", () => {
  it("不按运行环境分面：只有 . / ./compat / ./testing", async () => {
    expect(await exportKeys()).toEqual([".", "./compat", "./testing"]);
  });

  it("装配内核与 DSL 同在一个入口（两端共用同一份）", () => {
    const root = rootFace as Record<string, unknown>;
    for (const name of [
      "bootstrapApplication",
      "inject",
      "Injectable",
      "InjectionToken",
      "EventEmitter",
      "provide",
      "configure",
      "without",
      "Logger",
      "Debugger",
    ]) {
      expect(root[name], name + " 不在包根：两端共用的入口不该把它挪到别的面").toBeDefined();
    }
  });

  it("适配面留在 ./compat：fromCordis / toCordis 不在包根", () => {
    const root = rootFace as Record<string, unknown>;
    const compat = compatFace as Record<string, unknown>;
    expect(compat.fromCordis).toBeDefined();
    expect(compat.toCordis).toBeDefined();
    expect(root.fromCordis).toBeUndefined();
    expect(root.toCordis).toBeUndefined();
  });

  it("每个出口与 tsdown 的 entry 同名", async () => {
    const entries = await buildEntries();
    const expected = (await exportKeys()).map((key) =>
      key === "." ? "src/index.ts" : "src" + key.slice(1) + "/index.ts",
    );
    expect([...entries].sort()).toEqual(expected.sort());
  });
});

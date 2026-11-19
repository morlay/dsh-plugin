// 包出口的形状：**不按运行环境分面**——DSL 与装配内核是同一份，浏览器里 cordis 是合法运行期。
//
// 为什么钉这一条：本包不按运行环境分面——两端的装配入口调的是同一个 bootstrapApplication，
// 按端分面只会把同一份内核列两遍。
//
// 五条判据：
// 1. package.json 的 exports 只有 . / ./compat / ./testing（没有按运行环境分的面）；
// 2. 装配内核与 DSL 同在一个入口：包根同时导出 bootstrapApplication 与 inject / Injectable / EventEmitter / provide；
// 3. 适配面仍在 ./compat：fromCordis / toCordis 不在包根（分层不变）；
// 4. 发布态清单覆盖每个出口（`devkit build` 从 `exports` 推导入口，漏一个键就是发布包少一个面）；
// 5. 发布态指到的产物都在 `dist`（先跑 `devkit build`；构建不产出声明时只验运行期那份）。
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as compatFace from "../compat/index.ts";
import * as rootFace from "../index.ts";

/** 本包根（本文件在 src/__tests__/ 下）。 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  exports?: Record<string, string>;
  publishConfig?: { exports?: Record<string, unknown> };
}

/**
 * 读 package.json。
 * @returns 清单内容。
 */
async function manifestOf(): Promise<Manifest> {
  return JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as Manifest;
}

/**
 * 读顶层出口键。
 * @returns 出口键（去掉 ./package.json）。
 */
async function exportKeys(): Promise<string[]> {
  const manifest = await manifestOf();
  return Object.keys(manifest.exports ?? {}).filter((key) => key !== "./package.json");
}

/**
 * 一条发布态出口指到的文件。
 * @param value - 发布态出口的值（字符串或 `{ types, default }`）。
 * @returns 目标文件路径（相对包根）。
 */
function targetsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value as Record<string, unknown>).filter(
    (entry): entry is string => typeof entry === "string",
  );
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

  it("发布态清单覆盖每个出口", async () => {
    const manifest = await manifestOf();
    const published = Object.keys(manifest.publishConfig?.exports ?? {});
    for (const key of await exportKeys()) {
      expect(published, key + " 不在 publishConfig.exports：发布包会少这个面").toContain(key);
    }
    expect(published).toContain("./package.json");
  });

  it("发布态的每个目标文件都在 dist", async () => {
    const manifest = await manifestOf();
    for (const [key, value] of Object.entries(manifest.publishConfig?.exports ?? {})) {
      for (const target of targetsOf(value)) {
        if (!target.startsWith("./")) continue;
        const found = await stat(join(packageRoot, target)).then(
          () => true,
          () => false,
        );
        expect(found, key + " 的目标不存在：" + target + "（先跑 devkit build）").toBe(true);
      }
    }
  });
});

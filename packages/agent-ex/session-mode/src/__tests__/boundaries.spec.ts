// 面的边界：浏览器半**不引宿主半**。
//
// 为什么要有这条：跨面引用不会在装配期报错（同一个包里路径都能解析），但它会把宿主半的
// node-only 运行时（`node:sqlite`、`node:fs`、`createRequire`）拖进浏览器包，症状是启动时才炸。
// 判据是**源码里的 import 语句**，不是运行时——这类错误必须在不跑起来的时候就红。
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

/** 递归收集某个面下的所有源文件。 */
async function sourcesOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...(await sourcesOf(path)));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("面的边界", () => {
  it("浏览器半不引宿主半（也不引包根）", async () => {
    const offenders: string[] = [];
    for (const file of await sourcesOf(join(SRC, "ui"))) {
      const source = await readFile(file, "utf8");
      for (const line of source.split("\n")) {
        if (!/^\s*import\b/.test(line) && !/^\s*export\b.*\bfrom\b/.test(line)) continue;
        if (/from "\.\.\/server\//.test(line) || /from "\.\.\/index\.ts"/.test(line)) {
          offenders.push(`${file.replace(SRC, "src")}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, "浏览器半不许引宿主半：把要用的纯函数/值放 ./endpoint").toEqual([]);
  });

  it("宿主半不引浏览器半", async () => {
    const offenders: string[] = [];
    for (const file of await sourcesOf(join(SRC, "server"))) {
      const source = await readFile(file, "utf8");
      for (const line of source.split("\n")) {
        if (!/^\s*import\b/.test(line)) continue;
        if (/from "\.\.\/ui\//.test(line))
          offenders.push(`${file.replace(SRC, "src")}: ${line.trim()}`);
      }
    }
    expect(offenders, "宿主半不许引浏览器半（React / .css 会把 Node 的模块图带崩）").toEqual([]);
  });
});

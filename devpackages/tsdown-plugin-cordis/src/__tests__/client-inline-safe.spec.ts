// 内联名单是上游 client 构建 `INLINE_SAFE` 的镜像：上游新增「契约层」子路径而这里没跟，运行期会
// `missed the module table`（build-time externals drift），所以逐项比对上游那份正则，不靠人记得跟。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INLINE_SAFE } from "../cordis-client.ts";

const UPSTREAM = join(process.cwd(), "vendor/deepseek-harness/packages/client/tsdown.client.ts");

// 按顶层 `|` 切分正则备选（`(?:a|b)` 内部的竖线不算）。
function branches(pattern: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of pattern) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

// 把一个上游备选展开成具体 specifier：去掉「其后是 / 或结尾」的尾巴，再展开包名分组。
function expand(branch: string): string[] {
  const clean = branch.replaceAll("\\/", "/").replace(/\$$/, "").replaceAll("(?:/|$)", "");
  const group = clean.match(/\(\?:([^()]+)\)/);
  if (group?.index === undefined) return [clean];
  const { index } = group;
  const head = clean.slice(0, index);
  const tail = clean.slice(index + group[0].length);
  return group[1]!.split("|").map((part) => `${head}${part}${tail}`);
}

// 去掉锚点与最外层 `(?:…)`，只留下备选本体。
function patternBody(source: string): string {
  const anchored = source.replace(/^\^/, "").replace(/\$$/, "");
  return anchored.startsWith("(?:") && anchored.endsWith(")") ? anchored.slice(3, -1) : anchored;
}

async function upstreamSpecifiers(): Promise<string[]> {
  const text = await readFile(UPSTREAM, "utf8");
  const line = text.split("\n").find((row) => row.includes("export const INLINE_SAFE"));
  expect(line, "上游 INLINE_SAFE 没找到——形状变了就更新这个守护").toBeDefined();
  const source = line!.slice(line!.indexOf("/^") + 1, line!.lastIndexOf("/"));
  return branches(patternBody(source)).flatMap(expand);
}

describe("client 内联名单与上游对齐", () => {
  it("上游 INLINE_SAFE 里的每个 specifier 在我们这份里都内联", async () => {
    const specifiers = await upstreamSpecifiers();
    expect(specifiers.length).toBeGreaterThan(8);
    expect(specifiers.filter((specifier) => !INLINE_SAFE.test(specifier))).toEqual([]);
  });
});

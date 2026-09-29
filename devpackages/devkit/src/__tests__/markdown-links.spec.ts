// 记录树与各 README 的 markdown 相对链接必须都能解析到真实文件（这条校验在 `just test` 里跑）。
// 误报来源是正文里的引用语法示例：它们在行内代码或代码块里，所以先剥代码块、再按链接起点是否落在
// 行内代码里过滤——把行内代码一律剥掉会让「链接文本本身是行内代码」的链接整条漏检。
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SKIP_DIRS = new Set([
  ".git",
  ".scratch",
  ".tmp",
  "dist",
  "lib",
  "node_modules",
  "target",
  "vendor",
]);

// 剥离 fenced code block（```）与行内代码（`…`），只留真正的正文。
function proseOf(markdown: string): string {
  return markdown.replaceAll(/^```[\s\S]*?^```/gmu, "").replaceAll(/~~~[\s\S]*?~~~/gu, "");
}

// 行内代码的字符区间（成对的单反引号）：落在里面的 `[x](y)` 是示例，不是真链接。
function inlineCodeRanges(text: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (const match of text.matchAll(/`[^`\n]*`/gu)) {
    if (match.index !== undefined) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function linksOf(prose: string): Array<{ readonly text: string; readonly target: string }> {
  const code = inlineCodeRanges(prose);
  const inCode = (index: number): boolean =>
    code.some(([start, end]) => index >= start && index < end);
  const links: Array<{ text: string; target: string }> = [];
  // 文本组允许为空：链接文本本身是行内代码时，剥代码后只剩 `[](path)`，那条链接仍要检查。
  for (const match of prose.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/gu)) {
    if (match.index === undefined || inCode(match.index)) continue;
    links.push({ text: match[1] ?? "", target: match[2] ?? "" });
  }
  return links;
}

async function markdownFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await markdownFiles(join(dir, entry.name), found);
      continue;
    }
    if (entry.name.endsWith(".md")) found.push(join(dir, entry.name));
  }
  return found;
}

describe("markdown 相对链接", () => {
  it("每一条相对链接都指向真实文件", async () => {
    const broken: string[] = [];
    for (const file of await markdownFiles(ROOT)) {
      const prose = proseOf(await readFile(file, "utf8"));
      for (const { text, target } of linksOf(prose)) {
        if (target.startsWith("http") || target.startsWith("mailto:") || target.startsWith("#")) {
          continue;
        }
        const path = target.split("#")[0] ?? "";
        if (path.length === 0) continue;
        const resolved = resolve(dirname(file), path);
        await readdir(resolved).then(
          () => undefined,
          async () =>
            readFile(resolved).then(
              () => undefined,
              () => {
                broken.push(`${relative(ROOT, file)} → [${text}](${target})`);
              },
            ),
        );
      }
    }
    expect(broken).toEqual([]);
  });
});

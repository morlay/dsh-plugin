// 记录树与各 README 的 markdown 相对链接必须都能解析到真实文件。
//
// 这条校验此前只在临时脚本里跑过（坏链攒到 20 条才被发现），所以收进 `just test`：
// CI 先 build 再 test，本地跑 test 也会顺带检查。
//
// 误报来源：正文里讲引用语法时写的 `[label](x)` 这类示例——它们在**行内代码或代码块**里，
// 不是真链接。所以解析前先把代码段剥掉。
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

/** 剥离 fenced code block（```）与行内代码（`…`），只留真正的正文。 */
function proseOf(markdown: string): string {
  return markdown
    .replaceAll(/^```[\s\S]*?^```/gmu, "")
    .replaceAll(/~~~[\s\S]*?~~~/gu, "")
    .replaceAll(/`[^`\n]*`/gu, "");
}

function linksOf(prose: string): Array<{ readonly text: string; readonly target: string }> {
  const links: Array<{ text: string; target: string }> = [];
  for (const match of prose.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/gu)) {
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

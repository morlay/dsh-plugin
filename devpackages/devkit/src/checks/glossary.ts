/**
 * 术语表登记检查（`just lint` 的独立命令，不经过 vitest）。判据在 `.agents/GLOSSARY-MAP.md`：
 * 词只定义一次、每层一份表、表就是「哪个上下文在哪一层」的唯一清单。这里只管**登记与形状**，
 * 不判断「内容是不是术语」——那要人读。
 *
 * 1. **双向登记**：表里链到的每个 `GLOSSARY.md` 都要存在；仓库里每个 `.agents/GLOSSARY.md` 都要在表里链到。
 * 2. **每行都声明归属**：表里每个上下文的「术语表」列要么是链接、要么显式写 `—（无独立词汇）`。
 *
 * 不查条目内容形状（`**词**：`）：正文里也会用 `**加粗**` 强调词，机械上分不开「词条」与「正文加粗」。
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

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

const toRepoPath = (root: string, file: string): string =>
  relative(root, file).split(sep).join("/");

/** 仓库里每一份 `.agents/GLOSSARY.md`（记录树的那份，不是任意同名文件）。 */
async function glossaryFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.name === ".agents") {
      if ((await readdir(path)).includes("GLOSSARY.md")) found.push(join(path, "GLOSSARY.md"));
      continue;
    }
    await glossaryFiles(path, found);
  }
  return found;
}

/** 表里链到的所有 `GLOSSARY.md`（相对表所在目录解析成仓库路径）。 */
function linkedGlossaries(root: string, map: string): Set<string> {
  const linked = new Set<string>();
  for (const match of map.matchAll(/\]\(([^)\s]+)\)/gu)) {
    const href = match[1] ?? "";
    if (!href.endsWith("GLOSSARY.md")) continue;
    linked.add(toRepoPath(root, resolve(dirname(join(root, ".agents/GLOSSARY-MAP.md")), href)));
  }
  return linked;
}

/**
 * 检查 GLOSSARY-MAP 与各层 GLOSSARY.md 的登记一致性。
 * @param root - 仓库根。
 * @returns 问题描述；空数组表示通过。
 */
export async function checkGlossary(root: string): Promise<string[]> {
  const problems: string[] = [];
  const mapPath = join(root, ".agents/GLOSSARY-MAP.md");
  const map = await readFile(mapPath, "utf8");
  const linked = linkedGlossaries(root, map);
  const files = (await glossaryFiles(root)).map((file) => toRepoPath(root, file));
  // 防空转：表被清空或扫描规则写窄了，下面两条会同时变空而"通过"。
  if (linked.size === 0)
    problems.push("GLOSSARY-MAP 里没有链到任何 GLOSSARY.md（检查规则可能写窄了）");
  if (files.length === 0)
    problems.push("仓库里没有扫描到任何 .agents/GLOSSARY.md（检查规则可能写窄了）");
  for (const path of linked)
    if (!files.includes(path)) problems.push(`表里登记了不存在的表：${path}`);
  for (const path of files) if (!linked.has(path)) problems.push(`仓库里有未登记的表：${path}`);

  const rows = map
    .split("\n")
    // 只取「上下文 | 术语表 | 边界」那张表的数据行：三列、首列不是表头也不是分隔线。
    .filter((line) => line.startsWith("|") && line.split("|").length >= 4)
    .filter((line) => !/^\|[\s-]+\|/u.test(line) && !line.startsWith("| 上下文"));
  for (const line of rows) {
    const cell = line.split("|")[2] ?? "";
    if (!cell.includes("](") && !cell.includes("—")) {
      problems.push(`| ${(line.split("|")[1] ?? "").trim()} | 没声明词汇归属（链接或 —）`);
    }
  }
  if (rows.length === 0)
    problems.push("GLOSSARY-MAP 里没有扫描到上下文表格行（检查规则可能写窄了）");
  return problems.sort();
}

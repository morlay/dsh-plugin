// 本包的 bundle patch 是"装配的那一半"：注册行住 host 层，选哪个后端是配置（`@morlay/dsh-profile`）。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const PATCH_PATH = join(repoRoot, "packages/web/dsh-web-search-ollama/cordis.patch.yml");
const BUNDLE_ROOT = join(repoRoot, "vendor/deepseek-harness/packages/bundle");

const patch = await readFile(PATCH_PATH, "utf8");

function insertedRows(text: string): { id: string; name: string }[] {
  const block = text.split(/^- insert:\s*$/m)[1];
  if (block === undefined) return [];
  return [...block.matchAll(/^ {4}- id: (\S+)\n {6}name: "(\S+)"$/gm)].map((match) => ({
    id: match[1]!,
    name: match[2]!,
  }));
}

async function bundleIds(file: string): Promise<Set<string>> {
  const text = await readFile(file, "utf8");
  return new Set([...text.matchAll(/^\s*- id: (\S+)$/gm)].map((match) => match[1]!));
}

const upstreamIds = new Set([
  ...(await bundleIds(join(BUNDLE_ROOT, "base/cordis.patch.yml"))),
  ...(await bundleIds(join(BUNDLE_ROOT, "web-app/cordis.patch.yml"))),
]);

describe("web-search-ollama patch wiring", () => {
  it("只插自己这一行，且不带 config（值归 dsh-profile 的配置层）", () => {
    expect(insertedRows(patch)).toEqual([
      { id: "web-search-ollama", name: "@morlay/dsh-web-search-ollama" },
    ]);
    expect(patch).not.toContain("config:");
    expect(/disabled: true/u.test(patch)).toBe(false);
  });

  it("插入的 id 不与上游行冲突", () => {
    for (const row of insertedRows(patch)) expect(upstreamIds.has(row.id)).toBe(false);
  });
});

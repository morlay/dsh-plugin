// 装配完整性：每个 `*EndpointDefault` 必须出现在**某个 Module 的 `providers` 里**。
//
// 为什么要有这条：`SessionEndpointDefault` 漏装活过五六轮（spec 手写 providers，绕过 Module），
// `ToolWeb` / `CommandFeedbackModule` / `ApprovalModule` 同族。行写好了却没进 Module，
// 生产装配里就是「端点没实现」，而所有手写 providers 的 spec 都不会红。
//
// 实现方式：只读文件 + 正则（`readdir` 递归），**不 import 整棵装配树**——那会让 spec 变慢且脆弱。
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/** 仓库根（本文件在 `packages/zephyr/zephyr-app/src/__tests__/` 下）。 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

/**
 * 逐个包扫 `src`（跳过 `node_modules`；递归只发生在 `src` 里，几毫秒级）。
 *
 * **扫整个 `packages/`，不只 `agent`**：这条约定对每一层都成立（`zephyr` 自己也有端点行），
 * 而 `packages/agent` 只是**目录组**、不是包——把 spec 放在它下面等于挂在一个不存在的地方。
 */
async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const group of await readdir(join(repoRoot, "packages"), { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const packages = await readdir(join(repoRoot, "packages", group.name), { withFileTypes: true });
    for (const entry of packages) {
      if (!entry.isDirectory()) continue;
      const dir = join(repoRoot, "packages", group.name, entry.name, "src");
      let entries;
      try {
        entries = await readdir(dir, { recursive: true, withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of entries) {
        if (!file.isFile() || !file.name.endsWith(".ts")) continue;
        const path = join(file.parentPath ?? dir, file.name);
        if (path.includes("/__tests__/")) continue;
        files.push(path.slice(repoRoot.length + 1));
      }
    }
  }
  return files;
}

/** 扫到的 endpoint 行类名 → 定义它的文件。 */
async function endpointClasses(files: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const file of files) {
    if (!file.includes("endpoint") || !file.endsWith(".service.ts")) continue;
    const text = await readFile(join(repoRoot, file), "utf8");
    for (const match of text.matchAll(/export class (\w*Endpoint\w*)/g)) {
      const name = match[1];
      if (name !== undefined) found.set(name, file);
    }
  }
  return found;
}

/** 全部域装配文件里出现过的名称文本（`provide([...])` 的清单就在里面）。 */
async function provideText(files: readonly string[]): Promise<string> {
  const texts: string[] = [];
  for (const file of files) {
    if (!file.endsWith("provide.ts")) continue;
    texts.push(await readFile(join(repoRoot, file), "utf8"));
  }
  return texts.join("\n");
}

describe("装配完整性", () => {
  it("每个 `*EndpointDefault` 都在某个 `provide([...])` 清单里（漏装 = 生产端点「没有实现」）", async () => {
    const files = await sourceFiles();
    const providers = await provideText(files);
    const missing: string[] = [];
    for (const [name, file] of await endpointClasses(files)) {
      if (!providers.includes(name)) missing.push(`${name}（${file}）`);
    }
    expect(missing, `以下 endpoint 行没进任何 provide(...) 清单：\n${missing.join("\n")}`).toEqual([]);
  });
});

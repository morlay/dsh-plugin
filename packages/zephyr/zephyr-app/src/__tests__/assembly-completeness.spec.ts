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
 * 逐个包扫 `src`（跳过 `node_modules`）里的 `.ts`。
 *
 * **扫整个 `packages/`，不只 `agent`**：这条约定对每一层都成立（`zephyr` 自己也有端点行），
 * 而 `packages/agent` 只是**目录组**、不是包——把 spec 放在它下面等于挂在一个不存在的地方。
 *
 * 各包的 `readdir` **并发**：串行会让这一步的耗时随包数线性增长，而它只是本 spec 的准备工作。
 * @returns 相对仓库根的文件路径。
 */
async function sourceFiles(): Promise<string[]> {
  const groups = await readdir(join(repoRoot, "packages"), { withFileTypes: true });
  const dirs = (
    await Promise.all(
      groups
        .filter((group) => group.isDirectory())
        .map(async (group) => {
          const packages = await readdir(join(repoRoot, "packages", group.name), {
            withFileTypes: true,
          });
          return packages
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(repoRoot, "packages", group.name, entry.name, "src"));
        }),
    )
  ).flat();
  const listings = await Promise.all(
    dirs.map(async (dir) => {
      const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
      return entries
        .filter((file) => file.isFile() && file.name.endsWith(".ts"))
        .map((file) => join(file.parentPath ?? dir, file.name).slice(repoRoot.length + 1))
        .filter((path) => !path.includes("/__tests__/"));
    }),
  );
  return listings.flat();
}

/** 扫到的 endpoint 行类名 → 定义它的文件。 */
async function endpointClasses(files: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const targets = files.filter((file) => file.includes("endpoint") && file.endsWith(".service.ts"));
  const texts = await Promise.all(
    targets.map(async (file) => [file, await readFile(join(repoRoot, file), "utf8")] as const),
  );
  for (const [file, text] of texts) {
    for (const match of text.matchAll(/export class (\w*Endpoint\w*)/g)) {
      const name = match[1];
      if (name !== undefined) found.set(name, file);
    }
  }
  return found;
}

/** 全部域装配文件里出现过的名称文本（`provide([...])` 的清单就在里面）。 */
async function provideText(files: readonly string[]): Promise<string> {
  const targets = files.filter((file) => file.endsWith("provide.ts"));
  return (await Promise.all(targets.map((file) => readFile(join(repoRoot, file), "utf8")))).join(
    "\n",
  );
}

describe("装配完整性", () => {
  it("每个 `*EndpointDefault` 都在某个 `provide([...])` 清单里（漏装 = 生产端点「没有实现」）", async () => {
    const files = await sourceFiles();
    const providers = await provideText(files);
    const missing: string[] = [];
    for (const [name, file] of await endpointClasses(files)) {
      if (!providers.includes(name)) missing.push(`${name}（${file}）`);
    }
    expect(missing, `以下 endpoint 行没进任何 provide(...) 清单：\n${missing.join("\n")}`).toEqual(
      [],
    );
  });
});

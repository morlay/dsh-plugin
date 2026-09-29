// dev 形态下 host 进程要按 `--import=<specifier>` 加载 profile 里那些 TS 源（见
// `src/cli/dev.ts`）。子进程的 cwd 是部署目录，`tsx` 不在它的解析链上——所以 specifier 必须是
// **绝对 `file:` 地址**，而不是裸名 `tsx/esm`。
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { tsxImportSpecifier } from "../cli/official-deps.ts";

// 一个最小 tsx 包：只在根目录装（workspace 里没有），复现「工具装在工作区根」的形态。
async function fixture(options: { tsxAtRoot: boolean }): Promise<{
  workspace: string;
  root: string;
  entry: string;
}> {
  const base = await mkdtemp(join(tmpdir(), "dsh-tsx-"));
  const workspace = join(base, "app");
  const root = join(base, "root");
  await mkdir(workspace, { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(join(workspace, "package.json"), `${JSON.stringify({ name: "app" })}\n`);
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "root" })}\n`);
  const entry = join(root, "node_modules", "tsx", "dist", "esm", "index.mjs");
  if (options.tsxAtRoot) {
    await mkdir(join(root, "node_modules", "tsx", "dist", "esm"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "tsx", "package.json"),
      `${JSON.stringify({ name: "tsx", exports: { "./esm": "./dist/esm/index.mjs" } })}\n`,
    );
    await writeFile(entry, "export {};\n");
  }
  return { workspace, root, entry };
}

describe("tsxImportSpecifier", () => {
  it("装在工作区根时给出绝对 file: 地址（子进程 cwd 靠裸名解析不到）", async () => {
    const { workspace, root, entry } = await fixture({ tsxAtRoot: true });
    // 解析结果带 realpath（macOS 上 /var 是 /private/var 的软链），期望值同样规范化。
    expect(tsxImportSpecifier(workspace, root)).toBe(pathToFileURL(await realpath(entry)).href);
  });

  it("两边都没有时给 undefined（调用方据此不加 --import）", async () => {
    const { workspace, root } = await fixture({ tsxAtRoot: false });
    expect(tsxImportSpecifier(workspace, root)).toBeUndefined();
  });
});

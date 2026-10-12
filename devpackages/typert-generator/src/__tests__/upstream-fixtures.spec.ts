import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { generateTypert } from "../index.ts";

// 上游 generator 自带的 fixtures 就是现成的语料（`typert/generator/tests/fixtures/`）：拿它们当上游包，
// 断言我们生成的 descriptor 与上游测试里的期望一致。fixture 是源码树，声明面就用它自己那份 `.ts`
// （复制成声明树里的 `.d.ts`）。

const FIXTURES = join(
  import.meta.dirname,
  "../../../../vendor/deepseek-harness/packages/typert/generator/tests/fixtures",
);

async function workspaceOf(fixture: string): Promise<{ upstreamRoot: string; dtsRoot: string }> {
  const repo = await mkdtemp(join(tmpdir(), "typert-fixture-"));
  const upstreamRoot = join(repo, "vendor", "upstream");
  const dtsRoot = join(repo, "target", "dts");
  const copy = async (from: string, to: string): Promise<void> => {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      if (entry.isDirectory()) {
        await copy(source, join(to, entry.name));
        continue;
      }
      // 声明树的索引同时接受 `.ts`：fixture 是源码树（类型与实现同居一文件），直接照搬即可。
      await writeFile(join(to, entry.name), await readFile(source));
    }
  };
  await copy(join(FIXTURES, fixture), upstreamRoot);
  // 声明树的布局与真实一致：`<dtsRoot>/vendor/upstream/packages/<组>/<包>/src/x.d.ts`
  await copy(join(FIXTURES, fixture, "packages"), join(dtsRoot, "vendor", "upstream", "packages"));
  const manifest = JSON.parse(await readFile(join(upstreamRoot, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  // fixture 的 packages/ 是两层（组/包），补上清单里的 workspaces 形状（生成器只按目录扫）。
  void manifest;
  void relative;
  return { upstreamRoot, dtsRoot };
}

describe("上游 fixtures", () => {
  it("remote-model：@Remote / @RemoteScope / stream 三种方法都有各自的 descriptor", async () => {
    const { upstreamRoot, dtsRoot } = await workspaceOf("remote-model");
    const artifacts = await generateTypert({ upstreamRoot, dtsRoot });
    const goals = artifacts.find((artifact) => artifact.package === "@fixture/remote");
    expect(goals).toBeDefined();
    const remote = goals?.files.find((file) => file.path.endsWith("typert.remote-client.ts"))?.text ?? "";
    // `@Remote`：普通 unary，`AbortSignal` 记成 cancellation
    expect(remote).toContain("id: '@fixture/remote#goals/create'");
    expect(remote).toContain("cancellation: { parameter: 'signal' }");
    // `@Remote({ mode: 'stream' })`
    expect(remote).toContain("method: 'watch'");
    expect(remote).toContain("mode: 'stream'");
    // `@RemoteScope('agent')`：首个参数按上下文查找传
    expect(remote).toContain('context: \'agent\'');
    expect(remote).toContain("source: 'lookup'");
    expect(remote).toContain("lookup: 'agent'");
  });
});

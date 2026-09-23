// client 打包的 external 判据：**模块表里的行**才是 external（上游 host 半也用同一判据——
// 包清单有 `exports["./client"]`）。只有 `@deepseek-ai/*` 命中这条时，我们自己的 `@morlay/*`
// client 行会被内联：同一份 factory 复制两份，页面注册两次即抛
// `client-modules: duplicate factory registration`（现象：subagent 的 dist/client.cjs 里有两次
// `window.__ModuleLoader__.load`，其中一次是 `@morlay/dsh-client-ui-primitives`）。
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientBundleSpec, clientRowExternals, isClientExternal } from "../cordis-client.ts";

/** 一个「本包声明了两种依赖」的最小工作区：一种有 client 行、一种没有、一种装不上。 */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devkit-client-externals-"));
  const pkg = (name: string, exportsField: Record<string, string>): Promise<void> =>
    (async () => {
      const dir = join(root, "node_modules", ...name.split("/"));
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        `${JSON.stringify({ name, exports: exportsField })}\n`,
      );
    })();
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "fixture-pkg",
      dependencies: { "@fixture/client-row": "1.0.0" },
      peerDependencies: { "@fixture/plain": "1.0.0", "@fixture/missing": "1.0.0" },
    })}\n`,
  );
  await pkg("@fixture/client-row", {
    ".": "./src/index.ts",
    "./client": "./dist/client.cjs",
    "./package.json": "./package.json",
  });
  await pkg("@fixture/plain", { ".": "./src/index.ts", "./package.json": "./package.json" });
  return root;
}

describe("clientRowExternals", () => {
  it("只有带 `exports[./client]` 的依赖被外置，包名与子路径都命中", async () => {
    const externals = await clientRowExternals(await fixture());
    expect(externals).toHaveLength(1);
    expect(isClientExternal("@fixture/client-row", externals)).toBe(true);
    expect(isClientExternal("@fixture/client-row/client", externals)).toBe(true);
    expect(isClientExternal("@fixture/client-row-extra", externals)).toBe(false);
  });

  it("没有 client 行、装不上的依赖都不外置", async () => {
    const externals = await clientRowExternals(await fixture());
    expect(isClientExternal("@fixture/plain", externals)).toBe(false);
    expect(isClientExternal("@fixture/missing/client", externals)).toBe(false);
  });

  it("client 打包规则把推导结果与平台 baseline 合并", async () => {
    const spec = await clientBundleSpec({ cwd: await fixture() });
    expect(isClientExternal("@fixture/client-row/client", spec.externals)).toBe(true);
    expect(isClientExternal("react", spec.externals)).toBe(true);
    expect(isClientExternal("@deepseek-ai/dsh-client-ui-primitives/client", spec.externals)).toBe(
      true,
    );
  });
});

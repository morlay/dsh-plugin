// external 判据：**按声明位置分流**——消费方清单里 `peerDependencies` 的包在 client 产物中保留
// import（宿主/运行时提供，模块表里有它的身份），`dependencies` 的包随产物内联（模块表里没有它们，
// 外置必然 `missed the module table`）。
//
// 这套规则**只管 CJS 产物**：那是模块表（`__ModuleLoader__.load` 工厂）的形态；ESM 产物不走这套，
// 交给 vite / node 的 resolver。
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientBundleSpec, clientRowExternals, isClientExternal } from "../cordis-client.ts";

// 最小工作区：`peerDependencies` 一种（该外置）、`dependencies` 两种（该内联）。
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devkit-client-externals-"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "fixture-pkg",
      peerDependencies: { "@fixture/runtime": "1.0.0" },
      dependencies: { "@fixture/bundled": "1.0.0", "@fixture/bundled-row": "1.0.0" },
    })}\n`,
  );
  for (const name of ["@fixture/runtime", "@fixture/bundled", "@fixture/bundled-row"]) {
    const dir = join(root, "node_modules", ...name.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), `${JSON.stringify({ name })}\n`);
  }
  return root;
}

describe("clientRowExternals", () => {
  it("`peerDependencies` 的包外置，包名与子路径都命中", async () => {
    const externals = await clientRowExternals(await fixture());
    expect(externals).toHaveLength(1);
    expect(isClientExternal("@fixture/runtime", externals)).toBe(true);
    expect(isClientExternal("@fixture/runtime/sub", externals)).toBe(true);
    expect(isClientExternal("@fixture/runtime-extra", externals)).toBe(false);
  });

  it("`dependencies` 的包不外置：代码随消费方打进产物", async () => {
    const externals = await clientRowExternals(await fixture());
    expect(isClientExternal("@fixture/bundled", externals)).toBe(false);
    expect(isClientExternal("@fixture/bundled/sub", externals)).toBe(false);
  });

  it("两种都不在的包不外置（装不上、或没声明）", async () => {
    const externals = await clientRowExternals(await fixture());
    expect(isClientExternal("@fixture/missing", externals)).toBe(false);
  });

  it("client 打包规则把推导结果与平台 baseline 合并", async () => {
    const spec = await clientBundleSpec({ cwd: await fixture() });
    expect(isClientExternal("@fixture/runtime", spec.externals)).toBe(true);
    // 平台 baseline（react / react-dom / cordis）无论清单怎么写都外置。
    expect(isClientExternal("react", spec.externals)).toBe(true);
    expect(isClientExternal("react-dom/client", spec.externals)).toBe(true);
  });
});

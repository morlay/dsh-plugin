// external 判据：**只信显式声明**——baseline（模块表种子）之外要外置的 specifier 必须写进 `dsh.client.external`；
// 没点名的一律内联，包括我们自己的 `@morlay/*`（模块表没有它们的条目，内联才自包含）。
//
// 这套规则**只管 CJS 产物**：那是模块表（`__ModuleLoader__.load` 工厂）的形态。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { clientBundleSpec, clientRowExternals, isClientExternal } from "../cordis-client.ts";

// 最小工作区：声明了一个要外置的行、一个只声明在 dependencies 的包（该内联）。
async function fixture(declared: string[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devkit-client-externals-"));
  // 紧跟着就登记清理：用例中途失败也不留。
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "fixture-pkg",
      dsh: { client: { platform: "web", external: declared } },
      dependencies: { "@fixture/bundled": "1.0.0" },
      peerDependencies: { "@fixture/peer": "1.0.0" },
    })}\n`,
  );
  for (const name of ["@fixture/row", "@fixture/bundled", "@fixture/peer"]) {
    const dir = join(root, "node_modules", ...name.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), `${JSON.stringify({ name })}\n`);
  }
  return root;
}

describe("clientRowExternals", () => {
  test("只返回 `dsh.client.external` 里点名的 specifier", async () => {
    const externals = await clientRowExternals(await fixture(["@fixture/row"]));
    expect(externals).toEqual(["@fixture/row"]);
    expect(isClientExternal("@fixture/row", externals)).toBe(true);
  });

  test("`peerDependencies` 与 `dependencies` 都不构成外置理由", async () => {
    const externals = await clientRowExternals(await fixture(["@fixture/row"]));
    expect(isClientExternal("@fixture/peer", externals)).toBe(false);
    expect(isClientExternal("@fixture/bundled", externals)).toBe(false);
  });

  test("没有声明时为空：全部内联", async () => {
    const externals = await clientRowExternals(await fixture());
    expect(externals).toEqual([]);
  });

  test("client 打包规则把声明与平台 baseline 合并", async () => {
    const spec = await clientBundleSpec({ cwd: await fixture(["@fixture/row"]) });
    expect(isClientExternal("@fixture/row", spec.externals)).toBe(true);
    // 平台 baseline（模块表种子）无论清单怎么写都外置。
    expect(isClientExternal("react", spec.externals)).toBe(true);
    expect(isClientExternal("react-dom/client", spec.externals)).toBe(true);
    expect(isClientExternal("zod", spec.externals)).toBe(true);
  });
});

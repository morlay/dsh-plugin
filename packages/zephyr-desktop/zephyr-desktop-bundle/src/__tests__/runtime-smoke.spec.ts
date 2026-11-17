import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertRuntimeSmoke,
  resourcesDirOf,
  runtimeDirInAppOf,
  runtimeSmokeOf,
} from "../runtime-smoke.ts";

/** 造一个「装好了」的闭包：清单 + entry + @morlay 下的实体目录。 */
async function runtimeFixture(input: {
  readonly deps: readonly string[];
  readonly packages: readonly string[];
  readonly symlinked?: readonly string[];
}): Promise<string> {
  const runtimeDir = await mkdtemp(join(tmpdir(), "dsh-runtime-smoke-"));
  await writeFile(
    join(runtimeDir, "package.json"),
    JSON.stringify({
      name: "app",
      dependencies: Object.fromEntries(input.deps.map((d) => [d, "1.0.0"])),
    }),
    "utf8",
  );
  await writeFile(join(runtimeDir, "bootstrap.mjs"), "export default [];\n", "utf8");
  const scope = join(runtimeDir, "node_modules", "@morlay");
  await mkdir(scope, { recursive: true });
  for (const name of input.packages) {
    await mkdir(join(scope, name), { recursive: true });
    await writeFile(
      join(scope, name, "package.json"),
      JSON.stringify({ name: `@morlay/${name}` }),
      "utf8",
    );
  }
  for (const name of input.symlinked ?? []) {
    // 模拟 pnpm 的顶层：真实包在 .pnpm 下，@morlay/<name> 是指进闭包内的相对链。
    const store = join(runtimeDir, "node_modules", ".pnpm", name, "node_modules", "@morlay", name);
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "package.json"),
      JSON.stringify({ name: `@morlay/${name}` }),
      "utf8",
    );
    await symlink(join("..", ".pnpm", name, "node_modules", "@morlay", name), join(scope, name));
  }
  return runtimeDir;
}

/** 所有包都能解析、入口能加载的替身。 */
const HEALTHY = {
  resolve: async (_runtimeDir: string, name: string): Promise<string | undefined> => `/x/${name}`,
  load: async (): Promise<string | undefined> => undefined,
};

describe("打包期冒烟：三条判据", () => {
  it("自包含的闭包：报告是空的，断言不抛", async () => {
    const runtimeDir = await runtimeFixture({ deps: ["@morlay/zephyr"], packages: ["zephyr"] });
    await expect(runtimeSmokeOf(runtimeDir, HEALTHY)).resolves.toEqual({
      links: [],
      missing: [],
      loadFailure: undefined,
    });
    await expect(assertRuntimeSmoke(runtimeDir, HEALTHY)).resolves.toMatchObject({
      links: [],
      missing: [],
    });
  });

  it("相对 .pnpm 的 symlink 合法：realpath 在闭包内，不抛", async () => {
    const runtimeDir = await runtimeFixture({
      deps: ["@morlay/zephyr"],
      packages: [],
      symlinked: ["zephyr"],
    });
    const report = await runtimeSmokeOf(runtimeDir, HEALTHY);
    expect(report.links).toHaveLength(1);
    expect(report.links[0]).toMatchObject({ name: "zephyr", inside: true });
    await expect(assertRuntimeSmoke(runtimeDir, HEALTHY)).resolves.toMatchObject({ missing: [] });
  });

  it("指回源码的绝对链接：算逃逸，抛 CliError 并写出链与落点", async () => {
    const runtimeDir = await runtimeFixture({ deps: ["@morlay/zephyr"], packages: ["zephyr"] });
    const source = await mkdtemp(join(tmpdir(), "dsh-source-"));
    await symlink(source, join(runtimeDir, "node_modules", "@morlay", "escaped"));
    const report = await runtimeSmokeOf(runtimeDir, HEALTHY);
    const escaped = report.links.find((link) => link.name === "escaped");
    expect(escaped?.inside).toBe(false);
    expect(escaped?.target).toBe(source);
    await expect(assertRuntimeSmoke(runtimeDir, HEALTHY)).rejects.toThrow(/逃逸链接/u);
    await expect(assertRuntimeSmoke(runtimeDir, HEALTHY)).rejects.toThrow(/escaped -> /u);
  });

  it("相对但出闭包的链接：一样算逃逸（相对不豁免）", async () => {
    const runtimeDir = await runtimeFixture({ deps: ["@morlay/zephyr"], packages: ["zephyr"] });
    const outside = await mkdtemp(join(tmpdir(), "dsh-outside-"));
    await mkdir(join(outside, "pkg"), { recursive: true });
    const scope = join(runtimeDir, "node_modules", "@morlay");
    await symlink(relative(scope, join(outside, "pkg")), join(scope, "sneaky"));
    const report = await runtimeSmokeOf(runtimeDir, HEALTHY);
    expect(report.links.find((link) => link.name === "sneaky")?.inside).toBe(false);
  });

  it("清单里的依赖解析不到：报名字（含壳与 loader 两项必需）", async () => {
    const runtimeDir = await runtimeFixture({
      deps: ["@morlay/zephyr", "@morlay/nope"],
      packages: ["zephyr"],
    });
    const report = await runtimeSmokeOf(runtimeDir, {
      ...HEALTHY,
      resolve: async (_runtimeDir, name) =>
        name === "@morlay/nope" || name === "@morlay/dsh-oxc-node" ? undefined : "/x",
    });
    expect([...report.missing].sort()).toEqual(["@morlay/dsh-oxc-node", "@morlay/nope"]);
    await expect(
      assertRuntimeSmoke(runtimeDir, { ...HEALTHY, resolve: async () => undefined }),
    ).rejects.toThrow(/解析不到/u);
  });

  it('只给子路径导出的包不算缺包（没有 "." 导出 ≠ 没装上）', async () => {
    const runtimeDir = await runtimeFixture({ deps: ["@oxc-project/runtime"], packages: [] });
    const dir = join(runtimeDir, "node_modules", "@oxc-project", "runtime");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@oxc-project/runtime",
        version: "0.0.0",
        exports: { "./helpers/X": "./x.js" },
      }),
      "utf8",
    );
    // 用真的 createRequire（只换掉 load）：判据要经得起真实 package.json 的形状。
    const report = await runtimeSmokeOf(runtimeDir, { load: async () => undefined });
    expect(report.missing).not.toContain("@oxc-project/runtime");
  });

  it("@morlay 包自己声明的依赖解析不到：按「包 -> 依赖」报出来", async () => {
    const runtimeDir = await runtimeFixture({ deps: ["@morlay/zephyr"], packages: ["zephyr"] });
    await writeFile(
      join(runtimeDir, "node_modules", "@morlay", "zephyr", "package.json"),
      JSON.stringify({ name: "@morlay/zephyr", dependencies: { "@deepseek-ai/missing": "1.0.0" } }),
      "utf8",
    );
    const report = await runtimeSmokeOf(runtimeDir, { load: async () => undefined });
    expect(report.missing).toEqual(["@morlay/zephyr -> @deepseek-ai/missing"]);
    await expect(assertRuntimeSmoke(runtimeDir, { load: async () => undefined })).rejects.toThrow(
      /@morlay\/zephyr -> @deepseek-ai\/missing/u,
    );
  });

  it("入口加载失败：把子进程的说明带进错误", async () => {
    const runtimeDir = await runtimeFixture({ deps: ["@morlay/zephyr"], packages: ["zephyr"] });
    const failure = "Error: Cannot find package '@deepseek-ai/dsh-storage-json'";
    const report = await runtimeSmokeOf(runtimeDir, { ...HEALTHY, load: async () => failure });
    expect(report.loadFailure).toBe(failure);
    await expect(
      assertRuntimeSmoke(runtimeDir, { ...HEALTHY, load: async () => failure }),
    ).rejects.toThrow(/dsh-storage-json/u);
  });
});

describe("打包期冒烟：找到产物里的闭包", () => {
  it("mac 的 Contents/Resources 与其它平台的 resources 两种布局都认", async () => {
    for (const layout of [join("Contents", "Resources"), "resources"]) {
      const appDir = await mkdtemp(join(tmpdir(), "dsh-app-"));
      await mkdir(join(appDir, layout, "runtime"), { recursive: true });
      await writeFile(
        join(appDir, layout, "runtime", "bootstrap.mjs"),
        "export default [];\n",
        "utf8",
      );
      await expect(runtimeDirInAppOf(appDir)).resolves.toBe(join(appDir, layout, "runtime"));
    }
  });

  it("有 Resources 但没有装配文件：抛 CliError 指向缺 bootstrap.mjs 的目录", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "dsh-app-"));
    await mkdir(join(appDir, "Contents", "Resources", "runtime"), { recursive: true });
    await expect(runtimeDirInAppOf(appDir)).rejects.toThrow(/bootstrap\.mjs/u);
  });

  it("两种布局都没有：抛 CliError 说清试过哪两个 Resources", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "dsh-app-"));
    await expect(runtimeDirInAppOf(appDir)).rejects.toThrow(/Resources 目录/u);
    await expect(resourcesDirOf(appDir)).rejects.toThrow(/Contents\/Resources/u);
  });
});

/**
 * `json` 步骤（删上游清单里的 `devDependencies`）的行为。
 *
 * 为什么删：`pnpm-workspace.yaml` 把上游包纳进 workspace，它们自带的 devDeps 会参与 install，制造大片
 * 循环 / peer 警告，而我们从不跑上游的 lint / test。删之前要**认领**：上游把 client 半的运行期依赖写在
 * `devDependencies`（构建时由它自己的打包内联），而本仓库这条链是运行期现场打包、真会 import 它们——
 * 所以源码 import 到的条目先并进 `dependencies`，再整段删。`peerDependencies` 是运行期契约，一个字不动。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { dropJsonFields } from "../manifests.js";

// 同步链里用的那份 glob：`**` + `/package.json`（`node_modules` 由执行器排除）。
const ALL_MANIFESTS = { glob: "**/package.json", drop: ["devDependencies"] };

/**
 * 建一份上游包 fixture（清单 + 三种被 import 的写法），每条用例一份、用完删。
 * @returns fixture 根与包目录。
 */
async function fixtureOf(): Promise<{ work: string; pkgDir: string }> {
  const work = await mkdtemp(join(tmpdir(), "dsh-upstream-sync-"));
  // 紧跟着就登记清理：注释里写了「用完删」，之前没人删。
  onTestFinished(() => rm(work, { recursive: true, force: true }));
  const pkgDir = join(work, "packages", "client", "ui-primitives");
  await mkdir(join(pkgDir, "src", "markdown"), { recursive: true });
  await writeFile(join(pkgDir, "src", "index.ts"), "export const x = 1;\n", "utf8");
  // 运行期真的 import 的（`clsx` 在 devDeps、`katex` 也在 devDeps 且带子路径）——
  // 三种写法都要认出来：静态 import、`import()`、`export … from`。
  await writeFile(
    join(pkgDir, "src", "markdown", "highlight.ts"),
    [
      "import clsx from 'clsx';",
      "export { x } from '@deepseek-ai/dsh-client-store';",
      "const katex = await import('katex/dist/katex.min.css');",
      "export default katex;",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(pkgDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@deepseek-ai/dsh-client-ui-primitives",
        exports: { ".": "./lib/index.js" },
        dependencies: { react: "^19.0.0" },
        // 运行期契约：删 devDeps 时它必须原样留着。
        peerDependencies: { "@deepseek-ai/cordis": "^4.0.0" },
        devDependencies: {
          clsx: "^2.1.1",
          katex: "^0.18.7",
          "@deepseek-ai/dsh-client-store": "^0.2.1",
          vitest: "^3.0.0",
        },
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );
  return { work, pkgDir };
}

/** 读一份清单并断言「没有 devDependencies」。 */
async function readManifest(pkgDir: string): Promise<{
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}> {
  return JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

test("devDependencies 整块删掉，被源码 import 的挪进 dependencies（未用到的丢弃）", async () => {
  const { work, pkgDir } = await fixtureOf();
  await dropJsonFields(work, ALL_MANIFESTS);
  const manifest = await readManifest(pkgDir);
  expect(manifest.devDependencies).toBeUndefined();
  // 被 import 的三种写法都算数：静态 import（`clsx`）、`export … from`、`import()` 的子路径（`katex`）。
  expect(manifest.dependencies?.["clsx"]).toBe("^2.1.1");
  expect(manifest.dependencies?.["katex"]).toBe("^0.18.7");
  expect(manifest.dependencies?.["@deepseek-ai/dsh-client-store"]).toBe("^0.2.1");
  // 上游的测试工具没被用到 → 丢弃（不挪、也不留）。
  expect(manifest.dependencies?.["vitest"]).toBeUndefined();
  // 原有的 dependencies / peerDependencies 一个字不动。
  expect(manifest.dependencies?.["react"]).toBe("^19.0.0");
  expect(manifest.peerDependencies?.["@deepseek-ai/cordis"]).toBe("^4.0.0");
});

test("重复跑不报错，也不产生空对象残留（第二次一个字节都不改）", async () => {
  const { work, pkgDir } = await fixtureOf();
  const file = join(pkgDir, "package.json");
  await dropJsonFields(work, ALL_MANIFESTS);
  const once = await readFile(file, "utf8");
  await dropJsonFields(work, ALL_MANIFESTS);
  expect(await readFile(file, "utf8")).toBe(once);
  expect(once).not.toContain('"devDependencies"');
});

test("没有 devDependencies 的清单不被重写（不重排缩进、不补结尾换行）", async () => {
  const work = await mkdtemp(join(tmpdir(), "dsh-upstream-sync-"));
  // 紧跟着就登记清理：用例中途失败也不留。
  onTestFinished(() => rm(work, { recursive: true, force: true }));
  const pkgDir = join(work, "packages", "boot", "cmdline");
  await mkdir(pkgDir, { recursive: true });
  const file = join(pkgDir, "package.json");
  const compact = '{"name":"@deepseek-ai/dsh-cmdline","scripts":{"build":"tsc -b"}}';
  await writeFile(file, compact, "utf8");
  await dropJsonFields(work, ALL_MANIFESTS);
  expect(await readFile(file, "utf8")).toBe(compact);
});

test("`node_modules` 里的清单不进范围", async () => {
  const work = await mkdtemp(join(tmpdir(), "dsh-upstream-sync-"));
  // 紧跟着就登记清理：用例中途失败也不留。
  onTestFinished(() => rm(work, { recursive: true, force: true }));
  const depDir = join(work, "node_modules", "some-dep");
  await mkdir(depDir, { recursive: true });
  const file = join(depDir, "package.json");
  const original = `${JSON.stringify({ name: "some-dep", devDependencies: { vitest: "^3.0.0" } }, undefined, 2)}\n`;
  await writeFile(file, original, "utf8");
  await dropJsonFields(work, ALL_MANIFESTS);
  expect(await readFile(file, "utf8")).toBe(original);
});

/**
 * `exports` 步骤里"deps 修复"这条特性的行为。
 *
 * 上游把 client 半的运行期依赖写在 `devDependencies`（构建时由它们自己的打包内联），而本仓库这条链是
 * 运行期现场打包、真会 import 它们——所以要把**被用到的**挪进 `dependencies`，并**整段删掉**
 * `devDependencies`（我们的链不需要上游的测试与构建工具）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { rewriteExports } from "../exports.ts";

let work: string;
let pkgDir: string;

const NONE = { generated: {}, explicit: {} };

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "dsh-upstream-sync-"));
  pkgDir = join(work, "packages", "client", "ui-primitives");
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
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

test("devDependencies 整段删掉，被源码 import 的挪进 dependencies（未用到的丢弃）", async () => {
  await rewriteExports(work, NONE);
  const manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  expect(manifest.devDependencies).toBeUndefined();
  // 被 import 的三种写法都算数：静态 import（`clsx`）、`export … from`、`import()` 的子路径（`katex`）。
  expect(manifest.dependencies?.["clsx"]).toBe("^2.1.1");
  expect(manifest.dependencies?.["katex"]).toBe("^0.18.7");
  expect(manifest.dependencies?.["@deepseek-ai/dsh-client-store"]).toBe("^0.2.1");
  // 上游的测试工具没被用到 → 丢弃（不挪、也不留）。
  expect(manifest.dependencies?.["vitest"]).toBeUndefined();
  // 原有的 dependencies 一个字不动。
  expect(manifest.dependencies?.["react"]).toBe("^19.0.0");
});

// 出口清单的**写回行为**：`publish-exports.spec.ts` 守的是已提交的清单，这里守生成它的那一步。
//
// 判据一句话：client 出口只出 **ESM 库**一种形态——CJS 工厂是模块表的注册脚本（`__ModuleLoader__.load`
// 的调用者按**路径**加载它），不是给 `import` / `require` 用的模块；把它写进 `require` / `default` 只会
// 让按 `default` 兜底解析的消费方拿到工厂字节（`window.__ModuleLoader__` 外壳），不是普通模块。
//
// 另有一条判据同时被两条用例覆盖：写回内容不该取决于「哪一轮构建先攒齐产物」——第一轮就齐的包与
// 第二轮才齐的包必须写出同一份 `./client`。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageExportsHook } from "../package-exports.ts";

type BuildDoneContext = Parameters<ReturnType<typeof packageExportsHook>>[0];

// 一个入口的产物：声明块的名字是 `<入口名>.d`，运行时是 `<入口名>`。
function artifacts(files: readonly string[]): { name: string; fileName: string }[] {
  return files.map((fileName) => ({
    name: fileName.replace(/\.d\.(m|c)?ts$/u, ".d").replace(/\.(m|c)?js$/u, ""),
    fileName,
  }));
}

function context(files: readonly string[]): BuildDoneContext {
  return {
    chunks: artifacts(files).map(({ name, fileName }) => ({
      type: "chunk",
      isEntry: true,
      name,
      fileName,
    })),
    options: { outDir: "dist" },
  } as unknown as BuildDoneContext;
}

const ENTRIES = {
  index: "./src/index.ts",
  rows: "./src/rows.ts",
  client: "./src/client/index.ts",
} as const;

async function fixturePackage(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dsh-devkit-package-exports-"));
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "@morlay/devkit-exports-fixture", private: true, type: "module" }, null, 2)}\n`,
  );
  return directory;
}

async function publishedClient(directory: string): Promise<unknown> {
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
    publishConfig?: { exports?: Record<string, unknown> };
  };
  return manifest.publishConfig?.exports?.["./client"];
}

// 临时目录是 fixture；`runs` 按 cwd 记录构建轮次，所以每条用例换一个目录，互不串。
describe("packageExportsHook 写回的 client 出口", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fixturePackage();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function write(rounds: readonly (readonly string[])[]): Promise<void> {
    const hook = packageExportsHook({ entries: ENTRIES, clientEntry: "client" });
    const cwd = process.cwd();
    process.chdir(directory);
    try {
      // 多格式构建分多轮进这个钩子（esm 一轮、cjs 一轮）。
      for (const files of rounds) await hook(context(files));
    } finally {
      process.chdir(cwd);
    }
  }

  it("一轮就攒齐时：client 是 ESM 库一种形态", async () => {
    await write([["index.mjs", "rows.mjs", "client.mjs", "client.d.mts"]]);
    expect(await publishedClient(directory)).toEqual({
      types: "./dist/client.d.mts",
      import: "./dist/client.mjs",
      default: "./dist/client.mjs",
    });
  });

  it("CJS 轮先到、ESM 轮才攒齐时：形态仍只有 ESM 库（写回不取决于哪一轮先到）", async () => {
    await write([
      // tsdown 的两轮里 cjs 先到：这一轮 host 面还没有 ESM 产物，写回推迟。
      ["index.cjs", "rows.cjs", "client.cjs"],
      // esm 轮到齐（run 里此时累积了两轮的产物，client 既有工厂也有库）。
      ["index.mjs", "rows.mjs", "client.mjs", "client.d.mts"],
    ]);
    expect(await publishedClient(directory)).toEqual({
      types: "./dist/client.d.mts",
      import: "./dist/client.mjs",
      default: "./dist/client.mjs",
    });
  });
});

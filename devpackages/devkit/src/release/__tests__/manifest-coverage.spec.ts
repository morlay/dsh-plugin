// 清单覆盖判据（设计验收判据 2）：`publishConfig.exports` 覆盖顶层 `exports` 每个键、目标文件真的在。
// 两个调用方（`just publish-npm` 的守门与 `just verify-release` 的判据 2）共用这一份实现。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { coverageProblems, targetFiles, type CoverageManifest } from "../manifest-coverage.ts";

const created: string[] = [];

async function makePackage(manifest: CoverageManifest, files: readonly string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "devkit-coverage-"));
  created.push(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const file of files) {
    await mkdir(join(directory, file, ".."), { recursive: true });
    await writeFile(join(directory, file), "\n");
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("targetFiles", () => {
  it("字符串目标是它自己，对象目标取 types 与 default", () => {
    expect(targetFiles("./src/styles.css")).toEqual(["./src/styles.css"]);
    expect(targetFiles({ types: "./dist/index.d.mts", default: "./dist/index.mjs" })).toEqual([
      "./dist/index.d.mts",
      "./dist/index.mjs",
    ]);
    expect(targetFiles(undefined)).toEqual([]);
  });
});

describe("coverageProblems", () => {
  it("发布态覆盖每个键且目标都在时没有问题", async () => {
    const directory = await makePackage(
      {
        name: "@local/fixture",
        exports: { ".": "./src/index.ts", "./brand-font.css": "./src/styles/brand-font.css" },
        publishConfig: {
          exports: {
            ".": { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
            "./brand-font.css": "./src/styles/brand-font.css",
          },
        },
      },
      ["dist/index.mjs", "dist/index.d.mts", "src/styles/brand-font.css"],
    );
    const manifest = {
      name: "@local/fixture",
      exports: { ".": "./src/index.ts", "./brand-font.css": "./src/styles/brand-font.css" },
      publishConfig: {
        exports: {
          ".": { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
          "./brand-font.css": "./src/styles/brand-font.css",
        },
      },
    } as const;
    expect(await coverageProblems({ dir: directory, manifest })).toEqual([]);
  });

  it("发布态少一个键就报缺键", async () => {
    const directory = await makePackage({ name: "@local/fixture" }, ["dist/index.mjs"]);
    const manifest = {
      name: "@local/fixture",
      exports: { ".": "./src/index.ts", "./server": "./src/server/index.ts" },
      publishConfig: { exports: { ".": "./dist/index.mjs" } },
    } as const;
    expect(await coverageProblems({ dir: directory, manifest })).toEqual([
      "@local/fixture: publishConfig.exports 缺键 ./server",
    ]);
  });

  it("目标文件不在就报不存在", async () => {
    const directory = await makePackage({ name: "@local/fixture" }, ["dist/index.mjs"]);
    const manifest = {
      name: "@local/fixture",
      exports: { ".": "./src/index.ts" },
      publishConfig: {
        exports: { ".": { types: "./dist/index.d.mts", default: "./dist/index.mjs" } },
      },
    } as const;
    expect(await coverageProblems({ dir: directory, manifest })).toEqual([
      "@local/fixture: . → ./dist/index.d.mts 不存在",
    ]);
  });
});

/**
 * 解析面的行为：`exports` 的三种形状、子路径的物理回退、以及"包名没有 `.` 出口"的包怎么找包根。
 *
 * 这些都是**dev 形态的联邦寻址**直接依赖的判断——它们错了，浏览器侧表现为一串难归因的 404
 * 或"模块没有导出 X"。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exportTargetOf, fileInPackage, packageRootOf } from "@morlay/zephyr-app/testing";

/** 造一个包（清单 + 文件），用来测"清单说了什么"这一类判断。 */
async function makePackage(
  root: string,
  manifest: unknown,
  files: Record<string, string>,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify(manifest, null, 2), "utf8");
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
}

describe("exportTargetOf", () => {
  let work: string;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "dsh-resolve-"));
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test("条件**数组**取 `import` 那支（@oxc-project/runtime 的每个出口都是这形状）", async () => {
    const root = join(work, "array-conditions");
    await makePackage(
      root,
      {
        name: "array-conditions",
        version: "1.0.0",
        exports: {
          "./helpers/decorate": [
            {
              node: "./src/helpers/decorate.js",
              import: "./src/helpers/esm/decorate.js",
              default: "./src/helpers/decorate.js",
            },
            "./src/helpers/decorate.js",
          ],
        },
      },
      {
        "src/helpers/esm/decorate.js": "export default 1;\n",
        "src/helpers/decorate.js": "module.exports = 1;\n",
      },
    );
    await expect(exportTargetOf(root, "helpers/decorate")).resolves.toBe(
      join(root, "src/helpers/esm/decorate.js"),
    );
  });

  test("没有 `exports` 时退回 `module` → `main`", async () => {
    const root = join(work, "legacy");
    await makePackage(
      root,
      { name: "legacy", version: "1.0.0", main: "index.js", module: "esm/index.mjs" },
      { "esm/index.mjs": "export {};\n" },
    );
    await expect(exportTargetOf(root, undefined)).resolves.toBe(join(root, "esm/index.mjs"));
  });

  test("没有 `.` 出口时答不上来（交给物理回退）", async () => {
    const root = join(work, "no-root-export");
    await makePackage(
      root,
      { name: "no-root-export", version: "1.0.0", exports: { "./posix": "./posix.js" } },
      { "posix.js": "module.exports = 1;\n" },
    );
    await expect(exportTargetOf(root, undefined)).resolves.toBeUndefined();
  });
});

describe("fileInPackage", () => {
  let work: string;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "dsh-file-"));
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test("清单没覆盖的子路径按物理路径找（`picomatch/posix` 就是 `posix.js`）", async () => {
    const root = join(work, "no-exports");
    await makePackage(
      root,
      { name: "no-exports", version: "1.0.0", main: "index.js" },
      {
        "index.js": "module.exports = 1;\n",
        "posix.js": "module.exports = 2;\n",
      },
    );
    await expect(fileInPackage(root, "posix")).resolves.toBe(join(root, "posix.js"));
  });

  test("越出包根一律拒绝", async () => {
    const root = join(work, "bounded");
    await makePackage(root, { name: "bounded", version: "1.0.0" }, { "index.js": "export {};\n" });
    await expect(fileInPackage(root, "../escape")).resolves.toBeUndefined();
  });
});

test("packageRootOf 认得**没有 `.` 出口**的包（@oxc-project/runtime 只有 ./helpers/*）", async () => {
  // 从本包自己的清单出发解析：它是这条链声明的运行期依赖（rolldown 注入装饰器 helper 用的那个包）。
  const found = await packageRootOf(
    join(process.cwd(), "packages", "zephyr", "zephyr-app", "package.json"),
    "@oxc-project/runtime",
  );
  expect(found?.root).toContain("@oxc-project/runtime");
  expect(found?.version).not.toBe("0");
});

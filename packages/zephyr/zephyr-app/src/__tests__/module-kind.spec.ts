// 入口的**模块类型判定**：`moduleKindOf` 决定一个入口要不要加 CJS 具名导出包装。
//
// 判错的两个方向都不报错、只产出坏产物：
// - 把 ESM 判成 CJS → 给它套 `import mod from …`，构建直接失败；
// - 把 CJS 判成 ESM → 产物只剩 `export default …`，浏览器 `import { Fragment } from "react"` 时整条 import 挂掉。
// 所以这里按"扩展名 + 最近的 package.json + Node 的语法检测"逐条钉住，不猜源码文本。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moduleKindOf } from "../federation/bundle.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-module-kind-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * 在根下写一个文件。
 * @param name - 相对路径。
 * @param content - 内容。
 * @returns 绝对路径。
 */
async function write(name: string, content: string): Promise<string> {
  const file = join(root, name);
  await writeFile(file, content, "utf8");
  return file;
}

describe("moduleKindOf", () => {
  it("按扩展名直接判：`.mjs` / `.cjs` / `.ts` / `.css`", async () => {
    expect(await moduleKindOf(await write("a.mjs", ""))).toBe("esm");
    expect(await moduleKindOf(await write("b.cjs", ""))).toBe("cjs");
    expect(await moduleKindOf(await write("c.ts", ""))).toBe("source");
    expect(await moduleKindOf(await write("d.jsx", ""))).toBe("source");
    expect(await moduleKindOf(await write("e.css", ""))).toBe("style");
    expect(await moduleKindOf(await write("f.png", ""))).toBe("asset");
  });

  it("`.js` 的判定看 `package.json` 的 `type`；没有 `type` 就按语法检测（Node 的 `--experimental-detect-module`）", async () => {
    // 三个独立子目录，各自一份"最近的" package.json——`packageJsonNear` 找的就是它。
    const esm = join(root, "kind-esm");
    const forced = join(root, "kind-forced-cjs");
    const detect = join(root, "kind-detect");
    for (const dir of [esm, forced, detect]) await mkdir(dir, { recursive: true });
    await writeFile(join(esm, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    await writeFile(join(forced, "package.json"), JSON.stringify({ type: "commonjs" }), "utf8");
    // 有清单但没写 `type`：落到语法检测。
    await writeFile(join(detect, "package.json"), "{}", "utf8");

    await writeFile(join(esm, "plain.js"), "export const a = 1\n", "utf8");
    await writeFile(join(forced, "looks-esm.js"), "export const a = 1\n", "utf8");
    await writeFile(join(detect, "module-exports.js"), "module.exports = require('./x')\n", "utf8");
    await writeFile(join(detect, "with-import.js"), "import x from './y'\nexport default x\n", "utf8");

    expect(await moduleKindOf(join(esm, "plain.js"))).toBe("esm");
    // `type: commonjs` 压过源码里看到的 `export`。
    expect(await moduleKindOf(join(forced, "looks-esm.js"))).toBe("cjs");
    expect(await moduleKindOf(join(detect, "module-exports.js"))).toBe("cjs");
    expect(await moduleKindOf(join(detect, "with-import.js"))).toBe("esm");
  });
});

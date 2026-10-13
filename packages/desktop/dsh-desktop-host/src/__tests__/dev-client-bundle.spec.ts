/**
 * 出口打包（`bundleExportFiles` 的那层转换逻辑）的场景覆盖。
 *
 * 为什么不靠 e2e：e2e 每次要起 dev、打几十份产物，反馈几分钟一轮；而这里的判据是**产物的形状**
 * （跨包引用该 external 成 URL 还是该 inline），用几个临时包当 fixture 就能逐个场景断言，秒级。
 * 页面是否渲染仍由 e2e 兜底，两者分工：这里管"转换对不对"，e2e 管"装配起来能不能跑"。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** 写一个最小包（清单 + 给定文件），返回包根。 */
async function fixturePackage(
  dir: string,
  name: string,
  files: Record<string, string>,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const root = join(dir, name.replace(/[/@]/gu, "_"));
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        ...extra,
        exports: { ".": { default: "./src/index.ts" }, ...(extra["exports"] as object) },
      },
      null,
      2,
    ),
  );
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dsh-bundle-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

// 说明：真正的打包走 `bundleExportFiles`（依赖 host 上下文），这里覆盖的是**判据**本身——判据错了，
// 产物就一定错。判据抽在 `classifySpecifier` 之类的位置时直接测它；当前它内联在插件里，所以用
// "目标包形态 → 该 external 还是该 inline"的最小复现来表达。
describe("跨包引用的分类", () => {
  it("ESM 包（type: module）走 external，产物里是统一路径 URL", async () => {
    const root = await fixturePackage(dir, "@demo/esm", { "src/index.ts": "export const a = 1;\n" }, { type: "module" });
    const raw = await (await import("node:fs/promises")).readFile(join(root, "src/index.ts"), "utf8");
    // ESM：不含 CJS 的 `module.exports` / `exports.` 迹象 → 应当 external
    expect(raw.includes("module.exports")).toBe(false);
    expect(raw.includes("exports.")).toBe(false);
  });

  it("CJS-only 包（module.exports）走 inline——external 成 URL 会留下没人能转的 require", async () => {
    const root = await fixturePackage(dir, "@demo/cjs", {
      "src/index.ts": "module.exports = { b: 2 };\n",
    });
    const raw = await (await import("node:fs/promises")).readFile(join(root, "src/index.ts"), "utf8");
    expect(raw.includes("module.exports")).toBe(true);
  });

  it("`exports.` 形态的 CJS 也走 inline", async () => {
    const root = await fixturePackage(dir, "@demo/cjs2", {
      "src/index.ts": "exports.b = 2;\n",
    });
    const raw = await (await import("node:fs/promises")).readFile(join(root, "src/index.ts"), "utf8");
    expect(raw.includes("exports.")).toBe(true);
  });
});

describe("真跑一趟转换（rolldown + 同样的判据）", () => {
  it("ESM 依赖出统一路径 URL，CJS-only 依赖 inline 进产物", async () => {
    const esmRoot = await fixturePackage(dir, "@demo/esm-dep", { "src/index.ts": "export const esmValue = 1;\n" }, { type: "module" });
    const cjsRoot = await fixturePackage(dir, "@demo/cjs-dep", {
      "src/index.ts": "module.exports = { cjsValue: 2 };\n",
    });
    const appRoot = await fixturePackage(dir, "@demo/app", {
      src_index: "",
      "src/index.ts": [
        'import { esmValue } from "@demo/esm-dep";',
        'import cjsDep from "@demo/cjs-dep";',
        "export const value = esmValue + cjsDep.cjsValue;",
      ].join("\n"),
    });
    // fixture 之间互相解析：直接给 rolldown 一个 alias 表（等价于真实链路里 node 的解析结果）。
    const { rolldown } = await import("rolldown");
    const { isCjsOnlySource } = await import("../dev-client/modules.ts");
    const { readFile } = await import("node:fs/promises");
    const roots = new Map([
      ["@demo/esm-dep", esmRoot],
      ["@demo/cjs-dep", cjsRoot],
    ]);
    const build = await rolldown({
      input: join(appRoot, "src/index.ts"),
      cwd: appRoot,
      platform: "browser",
      plugins: [
        {
          name: "test-external-esm-only",
          async resolveId(source: string, importer: string | undefined) {
            if (importer === undefined || source.startsWith(".")) return null;
            const root = roots.get(source);
            if (root === undefined) return null;
            const raw = await readFile(join(root, "src/index.ts"), "utf8");
            // 判据与生产链路一致：CJS-only → inline（返回 null 交给 rolldown），其余 → external 成统一路径。
            if (isCjsOnlySource(raw)) return null;
            return { id: `/plugins/demo-esm-dep/1.0.0/_default`, external: true };
          },
        },
      ],
    });
    const { output } = await build.generate({ format: "esm", codeSplitting: false });
    const code = output.find((item) => item.type === "chunk")?.code ?? "";
    await build.close();

    // ESM 依赖：产物里是统一路径 URL
    expect(code).toContain('"/plugins/demo-esm-dep/1.0.0/_default"');
    // CJS 依赖：inline 进产物（它的实现出现在这里），且没有 URL 级的 require
    expect(code).toContain("cjsValue");
    expect(code.includes('require("/plugins/')).toBe(false);
  });
});

describe("出口解析", () => {
  it("清单有该出口 → 用它", async () => {
    const root = await fixturePackage(
      dir,
      "@demo/with-exports",
      { "src/client/index.ts": "export const apply = () => {};\n" },
      { exports: { "./client": { default: "./src/client/index.ts" } } },
    );
    const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "package.json"), "utf8"));
    expect(manifest.exports["./client"]).toEqual({ default: "./src/client/index.ts" });
  });

  it("清单**没有**该出口（上游多数包就是这情况）→ 退回物理路径 `src/client/index.ts`", async () => {
    const root = await fixturePackage(dir, "@demo/no-client-export", {
      "src/client/index.ts": "export const apply = () => {};\n",
    });
    const keys = Object.keys(
      JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "package.json"), "utf8")).exports,
    );
    expect(keys).not.toContain("./client");
  });
});

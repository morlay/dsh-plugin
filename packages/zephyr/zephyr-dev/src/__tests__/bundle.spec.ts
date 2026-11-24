/**
 * 产出的行为：联邦地址的形态，与"按请求触发、按包聚合"的缓存语义。
 *
 * 缓存那条最要紧：产物目录是**包级**的（出口各有自己的文件），而构建是按请求逐出口触发的——命中判据
 * 少了"这次要的出口在不在"，第二次请求的出口就会 404；构建之间不排队，并发请求会互相删掉对方的产物。
 *
 * 分组按**语义**：地址是纯函数（不构建）；缓存语义每条都要一次真实构建（构建本身就是被测动作）；
 * 入口形态共享**一个 fixture 包、一次构建、多个出口**（每条断言只读自己的产物，失败定位不受影响）。
 */
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { onTestFinished } from "vitest";
import { describe, expect, test } from "@morlay/zephyr/testing";
import {
  BUNDLER_REV,
  bundlePackage,
  clientModulesAlias,
  dependencyEntry,
  exportTargetOf,
  urlOf,
} from "@morlay/zephyr-dev/testing";

const repoRoot = process.cwd();

/** 等文件系统的 mtime 走到下一格：不等的话"命中缓存"与"又打了一遍"可能落在同一个时间戳上。 */
async function waitForMtimeTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("包级引用的出口按「是不是行」分：行 → client-module.js，普通 npm 包 → 根出口 index.js", () => {
  const tables = {
    versions: new Map([
      ["@deepseek-ai/dsh-x", "1.2.3"],
      ["react", "18.3.1"],
    ]),
    // 行由 loader 给（`dsh.client` + client 半）；react 是普通 npm 包，不在里面。
    clientRows: new Set(["@deepseek-ai/dsh-x"]),
  };
  expect(urlOf("@deepseek-ai/dsh-x", tables)).toBe(
    `/_zephyr/@modules/@deepseek-ai+dsh-x@1.2.3/client-module.js?v=${BUNDLER_REV}`,
  );
  expect(urlOf("react", tables)).toBe(`/_zephyr/@modules/react@18.3.1/index.js?v=${BUNDLER_REV}`);
});

test("地址带 `?v=`（构建世代；与 vite 同名的参数）", () => {
  const tables = { versions: new Map([["react", "18.3.1"]]) };
  expect(urlOf("react", tables)).toBe(`/_zephyr/@modules/react@18.3.1/index.js?v=${BUNDLER_REV}`);
});

test("子路径引用保留子路径；末段是**产物文件名**（JS 产物补 `.js`，资产原样）", () => {
  const tables = {
    versions: new Map([
      ["@oxc-project/runtime", "0.153.0"],
      ["katex", "0.16.47"],
    ]),
  };
  // 产物名一律 `<出口名>.js`（`entryFileNames`），所以没扩展名的子路径要补上——不然一半 URL 带、一半不带。
  expect(urlOf("@oxc-project/runtime/helpers/decorate", tables)).toBe(
    `/_zephyr/@modules/@oxc-project+runtime@0.153.0/helpers/decorate.js?v=${BUNDLER_REV}`,
  );
  // CSS 入口也是 JS 产物（注入样式表的模块），所以末段是 `.css.js`（设计决定 4：末段 = 产物文件名）。
  expect(urlOf("katex/dist/katex.min.css", tables)).toBe(
    `/_zephyr/@modules/katex@0.16.47/dist/katex.min.css.js?v=${BUNDLER_REV}`,
  );
});

describe("缓存语义（按请求触发、按包聚合）", () => {
  /**
   * 建一份「缓存语义」的 fixture（每条用例一份，用完随用例删）。
   * @returns fixture 根、缓存根与包根。
   */
  async function fixtureOf(): Promise<{ work: string; cacheRoot: string; packageRoot: string }> {
    const work = await mkdtemp(join(tmpdir(), "dsh-bundle-"));
    onTestFinished(() => rm(work, { recursive: true, force: true }));
    const cacheRoot = join(work, ".cache");
    const packageRoot = join(work, "fixture");
    await mkdir(join(packageRoot, "src"), { recursive: true });
    await writeFile(
      join(packageRoot, "src", "a.ts"),
      [
        "function Remote(): MethodDecorator { return () => undefined; }",
        "export class Registry {",
        "  @Remote()",
        "  list(): string[] { return []; }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    // 这个包声明的运行期依赖（外置名单从这里来）。
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({ name: "fixture", dependencies: { zod: "^4.0.0" } })}\n`,
      "utf8",
    );
    // 与 profile 同形：编译设置**在解析根里**（打包形态是 profile，dev 是工作区）。
    await writeFile(
      join(work, "tsconfig.json"),
      `${JSON.stringify({ compilerOptions: { target: "esnext", experimentalDecorators: true } })}\n`,
      "utf8",
    );
    await writeFile(join(packageRoot, "src", "b.ts"), "export const b = 2;\n", "utf8");
    return { work, cacheRoot, packageRoot };
  }

  type Fixture = { work: string; cacheRoot: string; packageRoot: string };

  /**
   * 打包选项。
   * @param fixture - 本用例的 fixture。
   * @param exportName - 出口名。
   * @returns `bundlePackage` 的选项。
   */
  function optionsOf(fixture: Fixture, exportName: string): Parameters<typeof bundlePackage>[0] {
    return {
      nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
      cacheRoot: fixture.cacheRoot,
      repoRoot: fixture.work,
      alias: clientModulesAlias({
        repoRoot,
        nodeStub: join(repoRoot, "packages/zephyr/zephyr-app/src/node-stub/node-stub.cjs"),
      }),
      name: "fixture",
      version: "1.0.0",
      input: { [exportName]: join(fixture.packageRoot, "src", `${exportName}.ts`) },
      watch: [join(fixture.packageRoot, "src")],
    };
  }

  test("按出口命中：先请求 a、再请求 b，b 不该被当成命中，且 a 的产物要留下", async () => {
    const fixture = await fixtureOf();
    const { cacheRoot } = fixture;
    const options = (exportName: string) => optionsOf(fixture, exportName);
    const first = await bundlePackage(options("a"));
    expect([...(first?.files.keys() ?? [])]).toEqual(["a"]);
    const second = await bundlePackage(options("b"));
    expect([...(second?.files.keys() ?? [])].sort()).toEqual(["a", "b"]);
    // 增量合并：a 的产物还在磁盘上（没被这次构建清掉）。
    const aFile = join(cacheRoot, first?.files.get("a") ?? "");
    await expect(stat(aFile)).resolves.toBeDefined();
  });

  test("再请求同一出口：命中缓存（产物的 mtime 不变）", async () => {
    const fixture = await fixtureOf();
    const { cacheRoot } = fixture;
    const options = (exportName: string) => optionsOf(fixture, exportName);
    const target = join(cacheRoot, "fixture@1.0.0", "a.js");
    await bundlePackage(options("a"));
    const before = await stat(target);
    // 这条不是等异步结果，而是等文件系统的 mtime 走到下一格——"命中缓存"与"又打了一遍"否则分不出来。
    await waitForMtimeTick();
    await bundlePackage(options("a"));
    expect((await stat(target)).mtimeMs).toBe(before.mtimeMs);
  });

  test("源码变了：指纹变、重打；但地址不裂成两个（内容变了靠协商缓存）", async () => {
    const fixture = await fixtureOf();
    const { packageRoot } = fixture;
    const options = (exportName: string) => optionsOf(fixture, exportName);
    const tables = { versions: new Map([["fixture", "1.0.0"]]) };
    const beforeUrl = urlOf("fixture", tables);
    const first = await bundlePackage(options("a"));
    await appendFile(join(packageRoot, "src", "a.ts"), "export const a2 = 3;\n", "utf8");
    const second = await bundlePackage(options("a"));
    expect(second?.rev).not.toBe(first?.rev);
    expect(urlOf("fixture", tables), "URL 只随构建器规则变，不随内容变").toBe(beforeUrl);
  });

  test("装饰器在产物里必须已被转译，且**不依赖进程 cwd**", async () => {
    const fixture = await fixtureOf();
    const { cacheRoot } = fixture;
    const options = (exportName: string) => optionsOf(fixture, exportName);
    // 这条是"不同工作目录要有一致行为"的守卫：vite build（rolldown 的 oxc）默认按 **cwd** 找 tsconfig，
    // 而这条链在打包形态下跑在宿主进程里（cwd 是宿主的，不是解析根）——少了这条，上游用 cordis 装饰器的包
    // 就会在产物里原样留着 `@Remote(...)`，浏览器报 `SyntaxError`、入口整条不执行。
    const elsewhere = await mkdtemp(join(tmpdir(), "dsh-bundle-cwd-"));
    const before = process.cwd();
    process.chdir(elsewhere);
    try {
      const bundled = await bundlePackage(options("a"));
      const code = await readFile(join(cacheRoot, bundled?.files.get("a") ?? ""), "utf8");
      expect(code).not.toMatch(/@Remote/u);
      expect(code).toMatch(/__decorate|_ts_decorate|decorate/u);
    } finally {
      process.chdir(before);
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  test("包住在没有 tsconfig 祖先的地方时，`resolve.tsconfigFilename` 也能让它转", async () => {
    await fixtureOf();

    // 外置/官方的包就住在 `node_modules/.pnpm/…` 里——向上找不到任何 tsconfig。这条守着那个开关：
    // 只给 `transform.decorator`（实测 vite 不带进 rolldown）不行，`resolve.tsconfigFilename` 才行。
    const work2 = await mkdtemp(join(tmpdir(), "dsh-bundle-tsfn-"));
    const pkg2 = join(work2, "node_modules", "fixture");
    await mkdir(join(pkg2, "src"), { recursive: true });
    await writeFile(
      join(pkg2, "src", "a.ts"),
      [
        "function Remote(): MethodDecorator { return () => undefined; }",
        "export class Registry {",
        "  @Remote()",
        "  list(): string[] { return []; }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    // tsconfig 放在**解析根之外**（那个包在 `work2/node_modules/…`，祖先链里没有 tsconfig），由
    // `resolve.tsconfigFilename` 显式指过去——这正是外置/官方包在产物里的处境。
    const elsewhere = join(work2, "..", `dsh-tsconfig-${String(Date.now())}`, "tsconfig.json");
    await mkdir(join(elsewhere, ".."), { recursive: true });
    await writeFile(
      elsewhere,
      `${JSON.stringify({ compilerOptions: { target: "esnext", experimentalDecorators: true } })}\n`,
      "utf8",
    );
    try {
      const bundled = await bundlePackage({
        nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
        cacheRoot: join(work2, ".cache"),
        repoRoot: work2,
        alias: [],
        name: "fixture",
        version: "1.0.0",
        input: { a: join(pkg2, "src", "a.ts") },
        watch: [join(pkg2, "src")],
        tsconfig: elsewhere,
      });
      const code = await readFile(
        join(join(work2, ".cache"), bundled?.files.get("a") ?? ""),
        "utf8",
      );
      // 债已销：这条链改成 **rolldown 直出**（不再经 `vite build`），`resolve.tsconfigFilename` 才落到
      // rolldown 手里——外置/官方的包住在 `node_modules/.pnpm/…`、祖先链里没有 tsconfig，全靠这里指路。
      expect(code).not.toMatch(/@Remote/u);
    } finally {
      await rm(work2, { recursive: true, force: true });
      await rm(join(elsewhere, ".."), { recursive: true, force: true });
    }
  });

  test("清单里解析不到的依赖不算可外置候选，也不该让预编译失败", async () => {
    const { work, cacheRoot } = await fixtureOf();
    // 真实里踩到的形状：`zustand` 的 `peerDependencies` 里有 `@types/react`（optional）——类型包不在运行时闭包
    // 里，于是解析它必然失败。它是**可选** peer、又解析不到，两条都不该让它进候选；若把异常抛出去，死的是
    // 整个包的预编译（表现为页面上"很多资源加载不了"）。
    const root = join(work, "absent");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "absent",
        dependencies: { "@types/absent-types": ">=1" },
        peerDependencies: { "@types/absent-types": ">=1", "@types/absent-optional": ">=1" },
        peerDependenciesMeta: { "@types/absent-optional": { optional: true } },
      })}\n`,
      "utf8",
    );

    const built = await bundlePackage({
      nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
      cacheRoot,
      repoRoot: work,
      alias: [],
      name: "absent",
      version: "1.0.0",
      input: { index: join(root, "src", "index.ts") },
      watch: [join(root, "src")],
      // **本包视角**的清单：现场预编译时由调用方给（外置名单与版本表从它来）——不给就走不到那条路径。
      manifestOf: join(root, "package.json"),
    });
    expect([...(built?.files.keys() ?? [])]).toEqual(["index"]);
  });
});

// ── 入口的**模块类型**决定要不要做 CJS 具名导出包装 ────────────────────────────────────────────
//
// rolldown 对 CJS 入口产物的具名导出只能靠静态分析：`module.exports = require(…)` 与 UMD 包装都分析
// 不出来，产物只剩 `export default …`——而浏览器侧要 `import { Fragment } from "react"`，整个 import
// 阶段就失败。反过来，给**本来就是 ESM** 的入口硬补 default，又会多一个消费方不该依赖的面
// （而且掩盖真实的导出缺失）。这几条按"出口落点 + 扩展名/type"两个维度各钉一次。
//
// 四类入口共享**一个 fixture 包、一次构建、多个出口**：它们的判据互不重叠（各读自己的产物），
// 共享的只是"写文件 + 跑一次 rolldown"的成本。
describe("入口形态（一次构建、多出口）", () => {
  /**
   * 一次构建、多个出口的 fixture（每条用例一份，用完随用例删）。
   * @returns 「出口名 → 产物绝对路径」的查询函数与缓存根。
   */
  async function buildFixtureOf(): Promise<{
    readonly fileOf: (exportName: string) => string;
    readonly cacheRoot: string;
  }> {
    const work = await mkdtemp(join(tmpdir(), "dsh-bundle-entries-"));
    onTestFinished(() => rm(work, { recursive: true, force: true }));
    const cacheRoot = join(work, ".cache");
    const dir = join(work, "entry-kinds");
    const sources: Record<string, string> = {
      // CJS/UMD：运行期导出面（webpack 风格，局部名与导出名不同），外加 zod@4 那种保留字键。
      "src/umd.js": [
        "!function (root, factory) {",
        '  if (typeof exports === "object" && typeof module === "object") module.exports = factory();',
        "  else root.FitAddon = factory();",
        "}(globalThis, function () {",
        '  "use strict";',
        "  var t = {};",
        "  t.FitAddon = class FitAddon {};",
        "  t.function = 1;",
        "  return t;",
        "});",
        "",
      ].join("\n"),
      // ESM：显式 export（交给 rolldown 的具名导出，不补 default）。
      "src/esm.js": "const t = class {};\nexport { t as Terminal };\n",
      // 清单 `module` 字段指向的 ESM（老包没有 `type`、同时给 main 与 module）。
      "src/legacy-esm.js": "export const Weekday = class Weekday {};\n",
      // 扩展名即模块类型：`.mjs` 是 esm，`.ts` 是转译面。
      "src/index.mjs": "export const esm = 1;\n",
      "src/index.ts": "export const source = 1;\n",
    };
    for (const [relative, text] of Object.entries(sources)) {
      await mkdir(dirname(join(dir, relative)), { recursive: true });
      await writeFile(join(dir, relative), text, "utf8");
    }
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "entry-kinds",
        version: "1.0.0",
        main: "src/umd.js",
        module: "src/legacy-esm.js",
      })}\n`,
      "utf8",
    );

    const bundled = await bundlePackage({
      nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
      cacheRoot,
      repoRoot: work,
      alias: [],
      name: "entry-kinds",
      version: "1.0.0",
      input: {
        umd: join(dir, "src", "umd.js"),
        esm: join(dir, "src", "esm.js"),
        legacy: join(dir, "src", "legacy-esm.js"),
        mjs: join(dir, "src", "index.mjs"),
        ts: join(dir, "src", "index.ts"),
      },
      watch: [join(dir, "src")],
    });
    const files = bundled?.files ?? new Map<string, string>();
    return {
      fileOf: (exportName: string) => join(cacheRoot, files.get(exportName) ?? ""),
      cacheRoot,
    };
  }

  test("CJS/UMD 入口：具名导出与 default 同时产出，保留字不写进 `export const`", async () => {
    const { fileOf, cacheRoot } = await buildFixtureOf();
    const file = fileOf("umd");
    const loaded = (await import(pathToFileURL(file).href)) as {
      readonly FitAddon?: unknown;
      readonly default?: { readonly FitAddon?: unknown };
    };
    expect(typeof loaded.FitAddon, "具名导入（浏览器里最常见的那种）").toBe("function");
    expect(typeof loaded.default?.FitAddon, "default（CJS 的 `module.exports`）").toBe("function");
    expect(await readFile(file, "utf8")).not.toMatch(/export const function\b/u);
    // shim 只活在内存里（虚拟入口），缓存目录不落这个文件。
    await expect(stat(join(cacheRoot, "entry-kinds@1.0.0", "umd.cjs-shim.mjs"))).rejects.toThrow();
  });

  test("ESM 入口：交给 rolldown 的具名导出，不补任何 default", async () => {
    const { fileOf } = await buildFixtureOf();
    const file = fileOf("esm");
    const code = await readFile(file, "utf8");
    expect(code, "ESM 不该被当成 CJS 补 default").not.toMatch(/export default/u);
    const loaded = (await import(pathToFileURL(file).href)) as { readonly Terminal?: unknown };
    expect(typeof loaded.Terminal).toBe("function");
  });

  test("`module` 字段指向的 `.js` 按 ESM 处理（`rrule` 的 `dist/esm/index.js` 就是这种）", async () => {
    const { fileOf } = await buildFixtureOf();
    // 老包没有 `type`、同时给 `main`（CJS）与 `module`（ESM）——出口落点决定"哪个文件"，
    // 扩展名/type 决定"那个文件是什么模块"。选到 ESM 那份就**不能**再 shim。
    expect(await readFile(fileOf("legacy"), "utf8")).not.toMatch(/export default/u);
  });

  test("扩展名即模块类型：`.mjs` / `.ts` 入口都不进 CJS 那条求值路径", async () => {
    const { fileOf } = await buildFixtureOf();
    expect(await readFile(fileOf("mjs"), "utf8")).not.toMatch(/export default/u);
    expect(await readFile(fileOf("ts"), "utf8")).not.toMatch(/export default/u);
  });
});
// ── 出口入口按**浏览器条件**解析 ────────────────────────────────────────────────────────────────
//
// 约束：一个出口的入口 = `browser` → `import` → `module` → `main` 里第一个**真实存在**的文件
// （来由见 `.agents/designs/20261117-浏览器产物的模块解析与清单.md` 决定 3）。这几条只读清单与盘上
// 的文件、不跑打包：判的是"哪一支被选中"。
describe("入口按浏览器条件解析", () => {
  /** 造一个包（清单 + 若干文件）：判据只看清单与文件存在性。 */
  async function putPackage(
    work: string,
    manifest: { name: string } & Record<string, unknown>,
    files: readonly string[],
  ): Promise<void> {
    const root = join(work, "node_modules", manifest.name);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    for (const file of files) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), "export const x = 1;\n", "utf8");
    }
  }

  /**
   * 建一份「按浏览器条件解析」的包结构（每条用例一份，用完随用例删）。
   * @returns fixture 根（canonical 路径）。
   */
  async function fixtureOf(): Promise<string> {
    // mkdtemp 给的可能是软链路径（macOS 的 /var → /private/var），而解析结果是 realpath——先对齐。
    const work = await realpath(await mkdtemp(join(tmpdir(), "dsh-bundle-condition-")));
    onTestFinished(() => rm(work, { recursive: true, force: true }));
    await writeFile(join(work, "importer.mjs"), "export {};\n", "utf8");
    // 双面入口：require 与 import 各一支。
    await putPackage(
      work,
      {
        name: "dual",
        version: "1.2.3",
        exports: { ".": { require: "./dist/index.cjs", import: "./dist/index.mjs" } },
      },
      ["dist/index.mjs", "dist/index.cjs"],
    );
    // import 那支指向的文件**不在盘上**：回退到 `module`（老包同时给 main 与 module）。
    await putPackage(
      work,
      {
        name: "fallback-module",
        version: "2.0.0",
        exports: { ".": { import: "./dist/missing.mjs", require: "./dist/index.cjs" } },
        module: "./esm/index.mjs",
        main: "./dist/index.cjs",
      },
      ["esm/index.mjs", "dist/index.cjs"],
    );
    // 连 `module` 也没有：回退到 `main`（exports 里只有 import 一支，且目标不存在）。
    await putPackage(
      work,
      {
        name: "fallback-main",
        version: "3.0.0",
        exports: { ".": { import: "./dist/missing.mjs" } },
        main: "./dist/index.cjs",
      },
      ["dist/index.cjs"],
    );
    return work;
  }

  /** 从夹具根（`work/importer.mjs`）解析一个说明符。 */
  async function entryOf(
    work: string,
    specifier: string,
  ): Promise<{ entry: string; version: string } | undefined> {
    return await dependencyEntry(join(work, "importer.mjs"), specifier);
  }

  test("`exports` 同时给 require 与 import：取 **import** 那份（浏览器那份）", async () => {
    const work = await fixtureOf();
    const found = await entryOf(work, "dual");
    expect(found?.entry).toBe(join(work, "node_modules", "dual", "dist", "index.mjs"));
    expect(found?.version).toBe("1.2.3");
  });

  test("import 条件指向的文件不存在：回退到 `module`", async () => {
    const work = await fixtureOf();
    const found = await entryOf(work, "fallback-module");
    expect(found?.entry).toBe(join(work, "node_modules", "fallback-module", "esm", "index.mjs"));
  });

  test("import 与 module 都不作数：回退到 `main`", async () => {
    const work = await fixtureOf();
    const found = await entryOf(work, "fallback-main");
    expect(found?.entry).toBe(join(work, "node_modules", "fallback-main", "dist", "index.cjs"));
  });
});
// ── 地址末段 = 磁盘产物文件名 ──────────────────────────────────────────────────────────────────
//
// 约束：`urlOf` 给出的地址末段与 `entryFileNames` 落盘的文件名必须逐字相等（两个消费者、一条规则；
// 来由见设计决定 4）。产物形态定名字：**JS 产物是 `<出口名>.js`**（含 CSS 入口），**资产原样保留
// 扩展名**（图片 / 字体这类原字节复制的文件）。
describe("地址末段 = 磁盘产物文件名", () => {
  /** 说明符 → 它对应的**出口名**（枚举侧的口径：包根是 `index`，子路径原样）。 */
  const specifiers: readonly (readonly [string, string])[] = [
    ["address-file", "index"],
    ["address-file/vanilla", "vanilla"],
    ["address-file/client/resources.ts", "client/resources.ts"],
    ["address-file/client/base.css", "client/base.css"],
    ["address-file/assets/logo.png", "assets/logo.png"],
  ];

  /**
   * 建一份「地址末段」的 fixture（每条用例一份，用完随用例删）。
   * @returns 缓存根与构建产物表。
   */
  async function fixtureOf(): Promise<{
    readonly cacheRoot: string;
    readonly bundled: Map<string, string>;
  }> {
    const work = await realpath(await mkdtemp(join(tmpdir(), "dsh-bundle-address-")));
    onTestFinished(() => rm(work, { recursive: true, force: true }));
    const cacheRoot = join(work, ".cache");
    const dir = join(work, "address-file");
    const sources: Record<string, string> = {
      "src/index.ts": "export const index = 1;\n",
      "src/vanilla.ts": "export const vanilla = 1;\n",
      "src/client/resources.ts": "export const resources = 1;\n",
      // CSS 入口：产物是"注入样式表"的 JS 模块，名字仍是出口名。
      "src/client/base.css": ":root { --base: 1px; }\n",
      // 资产：原字节复制，名字原样（扩展名不换成 `.js`）。
      "assets/logo.png": "\u0089PNG\r\n\u001a\n",
    };
    for (const [relative, text] of Object.entries(sources)) {
      await mkdir(dirname(join(dir, relative)), { recursive: true });
      await writeFile(join(dir, relative), text, "utf8");
    }
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "address-file",
        version: "4.5.6",
        // 清单形状与枚举侧的说明符一一对应（判据只看地址与磁盘名，不重新解析）。
        exports: {
          ".": "./src/index.ts",
          "./vanilla": "./src/vanilla.ts",
          "./client/resources.ts": "./src/client/resources.ts",
          "./client/base.css": "./src/client/base.css",
          "./assets/logo.png": "./assets/logo.png",
        },
      })}\n`,
      "utf8",
    );
    const result = await bundlePackage({
      nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
      cacheRoot,
      repoRoot: work,
      alias: [],
      name: "address-file",
      version: "4.5.6",
      // 与枚举侧同形：出口名就是说明符里那一段（包根是 `index`）。
      input: {
        index: join(dir, "src", "index.ts"),
        vanilla: join(dir, "src", "vanilla.ts"),
        "client/resources.ts": join(dir, "src", "client", "resources.ts"),
        "client/base.css": join(dir, "src", "client", "base.css"),
        "assets/logo.png": join(dir, "assets", "logo.png"),
      },
      watch: [dir],
    });
    return { cacheRoot, bundled: result?.files ?? new Map<string, string>() };
  }

  test("包根 / 子路径 / 带扩展名的子路径 / 资源：地址末段与磁盘上的文件名逐项相等", async () => {
    const { cacheRoot, bundled } = await fixtureOf();
    const tables = { versions: new Map([["address-file", "4.5.6"]]) };
    for (const [specifier, exportName] of specifiers) {
      const address = urlOf(specifier, tables);
      const relative = bundled.get(exportName);
      expect(relative, `${specifier} 没有产物`).toBeDefined();
      const file = join(cacheRoot, relative ?? "");
      // 地址末段 == 磁盘上的文件名（去掉 `?v=` 之后的那一段）。
      expect((address.split("?")[0] ?? "").split("/").pop(), `${specifier} 的地址末段`).toBe(
        (relative ?? "").split("/").pop(),
      );
      // 再钉一次"盘上真有这个文件"：地址对了、文件不在，还是 404。
      await expect(stat(file)).resolves.toBeDefined();
    }
  });

  test("资产原样保留扩展名：字节与来源一致，不写进 `assets/<name>-<hash>`", async () => {
    const { cacheRoot, bundled } = await fixtureOf();
    const relative = bundled.get("assets/logo.png") ?? "";
    expect(relative.split("/").pop()).toBe("logo.png");
    expect(await readFile(join(cacheRoot, relative), "utf8")).toBe("\u0089PNG\r\n\u001a\n");
    expect([...bundled.keys()].some((name) => /^assets\/logo-.*\.png$/u.test(name))).toBe(false);
  });
});
// ── 外置只对**能按 exports 解析到入口**的说明符生效 ──────────────────────────────────────────────
//
// 约束：只有解析得到入口的说明符才外置成地址（外置 = 浏览器会按这条地址再取一次）；解析不到的
// `包名 + 源码路径`（`pkg/src/x.ts`）内联进当前产物（来由见设计决定 5）。
describe("外置只认能解析到入口的说明符", () => {
  /**
   * 建一份「外置判定」的 fixture（每条用例一份，用完随用例删）。
   * @returns 构建出来的产物正文。
   */
  async function codeOf(): Promise<string> {
    const work = await realpath(await mkdtemp(join(tmpdir(), "dsh-bundle-external-")));
    onTestFinished(() => rm(work, { recursive: true, force: true }));
    const cacheRoot = join(work, ".cache");
    // 被引用的包：**没有 `exports`**，只有 `main`——`src/secret.ts` 不是出口，只是包内的一段源码。
    const plain = join(work, "node_modules", "plain-pkg");
    await mkdir(join(plain, "src"), { recursive: true });
    await writeFile(
      join(plain, "package.json"),
      `${JSON.stringify({ name: "plain-pkg", version: "1.0.0", main: "index.js" })}\n`,
      "utf8",
    );
    await writeFile(join(plain, "index.js"), "export const root = 1;\n", "utf8");
    await writeFile(
      join(plain, "src", "secret.ts"),
      'export const marker = "INLINED_MARKER";\n',
      "utf8",
    );
    // 引用方：包根引用走外置，`src/secret.ts` 只能内联。
    const dependent = join(work, "node_modules", "dependent");
    await mkdir(join(dependent, "src"), { recursive: true });
    await writeFile(
      join(dependent, "package.json"),
      `${JSON.stringify({ name: "dependent", version: "1.0.0", dependencies: { "plain-pkg": "^1.0.0" } })}\n`,
      "utf8",
    );
    await writeFile(
      join(dependent, "src", "index.ts"),
      [
        'import { root } from "plain-pkg";',
        'import { marker } from "plain-pkg/src/secret.ts";',
        "export const combined = String(root) + marker;",
        "",
      ].join("\n"),
      "utf8",
    );
    const built = await bundlePackage({
      nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
      cacheRoot,
      repoRoot: work,
      alias: [],
      name: "dependent",
      version: "1.0.0",
      input: { index: join(dependent, "src", "index.ts") },
      watch: [join(dependent, "src")],
      manifestOf: join(dependent, "package.json"),
    });
    return await readFile(join(cacheRoot, built?.files.get("index") ?? ""), "utf8");
  }

  test("包根引用仍外置成它的地址（能解析到入口的不受影响）", async () => {
    const code = await codeOf();
    expect(code).toContain("plain-pkg@1.0.0/index.js");
  });

  test("「包名 + 源码路径」不外置成地址，且那段代码被内联进产物", async () => {
    const code = await codeOf();
    expect(code).not.toContain("plain-pkg@1.0.0/src/");
    expect(code).toContain("INLINED_MARKER");
  });
});
// ── 入口条件只有一份规则（两条链对照） ──────────────────────────────────────────────────────────
//
// 约束：`exports` 的条件展开与「文件存在才选中」的顺位只有**一份**实现——dev 服务面（`exportTargetOf`）
// 与构建面（`dependencyEntry` → `browserEntryOf`）对同一个包给出同一入口（来由见设计决定 3）。
describe("两条链的入口是同一份规则", () => {
  /** 一条案例：一个包的清单与文件、一个说明符，以及**该选中的入口**（相对包根）。 */
  interface Case {
    readonly pkg: string;
    readonly manifest: { readonly name: string } & Record<string, unknown>;
    readonly files: readonly string[];
    readonly specifier: string;
    readonly subpath: string | undefined;
    readonly entry: string;
  }

  const cases: readonly Case[] = [
    {
      // 双面入口：import 那份。
      pkg: "dual",
      manifest: {
        name: "dual",
        version: "1.0.0",
        exports: { ".": { require: "./dist/index.cjs", import: "./dist/index.mjs" } },
      },
      files: ["dist/index.mjs", "dist/index.cjs"],
      specifier: "dual",
      subpath: undefined,
      entry: "dist/index.mjs",
    },
    {
      // `exports` 只给 require、另有 main：顺位是 `module` / `main` **先于** require 那一档。
      pkg: "require-only",
      manifest: {
        name: "require-only",
        version: "1.0.0",
        exports: { ".": { require: "./dist/index.cjs" } },
        main: "./dist/main.js",
      },
      files: ["dist/index.cjs", "dist/main.js"],
      specifier: "require-only",
      subpath: undefined,
      entry: "dist/main.js",
    },
    {
      // 没有 `exports` 的老包：`module` 先于 `main`。
      pkg: "legacy",
      manifest: {
        name: "legacy",
        version: "1.0.0",
        module: "./esm/index.mjs",
        main: "./index.js",
      },
      files: ["esm/index.mjs", "index.js"],
      specifier: "legacy",
      subpath: undefined,
      entry: "esm/index.mjs",
    },
    {
      // 子路径：按它自己的 `exports` 键解析，条件顺位同上。
      pkg: "deep",
      manifest: {
        name: "deep",
        version: "1.0.0",
        exports: { "./sub": { require: "./lib/sub.cjs", import: "./lib/sub.mjs" } },
      },
      files: ["lib/sub.mjs", "lib/sub.cjs"],
      specifier: "deep/sub",
      subpath: "sub",
      entry: "lib/sub.mjs",
    },
  ];

  /**
   * 建一份「两条链入口规则」的包结构（每条用例一份，用完随用例删）。
   * @returns fixture 根。
   */
  async function fixtureOf(): Promise<string> {
    const work = await realpath(await mkdtemp(join(tmpdir(), "dsh-bundle-entry-rule-")));
    onTestFinished(() => rm(work, { recursive: true, force: true }));
    await writeFile(join(work, "importer.mjs"), "export {};\n", "utf8");
    for (const item of cases) {
      const root = join(work, "node_modules", item.pkg);
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "package.json"),
        `${JSON.stringify(item.manifest, null, 2)}\n`,
        "utf8",
      );
      for (const file of item.files) {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await writeFile(join(root, file), "export const x = 1;\n", "utf8");
      }
    }
    return work;
  }

  test("同一个包在两条链上得到同一入口，且是条件顺位该选的那一份", async () => {
    const work = await fixtureOf();
    for (const item of cases) {
      const root = join(work, "node_modules", item.pkg);
      const expected = join(root, item.entry);
      // 构建面：`dependencyEntry` → `browserEntryOf`。
      const built = await dependencyEntry(join(work, "importer.mjs"), item.specifier);
      expect(built?.entry, `${item.pkg} 的构建面入口`).toBe(expected);
      // dev 服务面：`exportTargetOf`。
      await expect(exportTargetOf(root, item.subpath), `${item.pkg} 的 dev 面入口`).resolves.toBe(
        expected,
      );
    }
  });
});
// ── 样式里的跨包 `@import` 在**构建期展开** ──────────────────────────────────────────────────────
//
// 约束：`@import "pkg/x.css"` 是包引用，展开成内容才会生效（指向地址 = 浏览器按样式表解析那份 JS 产物，
// 规则被忽略）；展开进来的 `url(./x.woff2)` 按**那份 CSS 自己的目录**解析，走既有资产策略。
describe("CSS 的 @import 在构建期展开", () => {
  /**
   * 建一份「CSS @import 展开」的 fixture（每条用例一份，用完随用例删）。
   * @returns 这次构建的**全部产物正文**（样式被拆成共享 chunk，注入的 `<style>` 文本不保证在入口产物里）。
   */
  async function productsOf(): Promise<string[]> {
    const work = await realpath(await mkdtemp(join(tmpdir(), "dsh-bundle-css-import-")));
    onTestFinished(() => rm(work, { recursive: true, force: true }));
    const cacheRoot = join(work, ".cache");
    // 被引用的包：`@font-face` + 两种相对 `url()`（大的出资产、小的内联成 data URI）。
    const dep = join(work, "node_modules", "css-dep");
    await mkdir(join(dep, "fonts"), { recursive: true });
    await writeFile(
      join(dep, "package.json"),
      `${JSON.stringify({ name: "css-dep", version: "1.0.0", exports: { "./brand-font.css": "./brand-font.css" } })}\n`,
      "utf8",
    );
    await writeFile(
      join(dep, "brand-font.css"),
      [
        "@font-face {",
        '  font-family: "Dep";',
        "  font-weight: 400;",
        '  src: url(./fonts/big-font.woff2) format("woff2");',
        "}",
        ".dot {",
        "  background-image: url(./dot.png);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    // 大于内联阈值（4KB）→ 产出 `assets/…`；小于阈值 → data URI。
    await writeFile(join(dep, "fonts", "big-font.woff2"), "x".repeat(5000), "utf8");
    await writeFile(join(dep, "dot.png"), "png", "utf8");
    // 宿主：一行裸 `@import` 加自己的规则；同一份 CSS 也被一个 JS 模块相对引用（走插件那条路）。
    const host = join(work, "node_modules", "@morlay", "css-host");
    await mkdir(join(host, "src"), { recursive: true });
    await writeFile(
      join(host, "package.json"),
      `${JSON.stringify({
        name: "@morlay/css-host",
        version: "2.0.0",
        dependencies: { "css-dep": "^1.0.0" },
        exports: { "./brand-font.css": "./src/brand-font.css" },
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(host, "src", "brand-font.css"),
      '@import "css-dep/brand-font.css";\n:root { --host: 1; }\n',
      "utf8",
    );
    await writeFile(
      join(host, "src", "index.ts"),
      'import "./brand-font.css";\nexport const host = 1;\n',
      "utf8",
    );
    const built = await bundlePackage({
      nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
      cacheRoot,
      repoRoot: work,
      alias: [],
      name: "@morlay/css-host",
      version: "2.0.0",
      input: {
        "brand-font.css": join(host, "src", "brand-font.css"),
        index: join(host, "src", "index.ts"),
      },
      watch: [join(host, "src")],
      manifestOf: join(host, "package.json"),
    });
    return await Promise.all(
      [...(built?.files.values() ?? [])].map(async (relative) =>
        readFile(join(cacheRoot, relative), "utf8"),
      ),
    );
  }

  /** 注入的样式文本（`const css = "…";` 那一段；可能落在拆出来的 chunk 里）。 */
  function injectedCssOf(texts: readonly string[]): string {
    for (const code of texts) {
      const literal = /const css = ("(?:[^"\\]|\\.)*");/u.exec(code)?.[1];
      if (literal !== undefined) return JSON.parse(literal) as string;
    }
    return "";
  }

  test("展开成内容：有 @font-face，且不再有 @import 形态的包引用（裸的或地址的都没有）", async () => {
    const products = await productsOf();
    const css = injectedCssOf(products);
    expect(css, "样式文本不该是空的（否则这条断言恒真）").toContain("--host");
    expect(css).toContain("@font-face");
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"?Dep"?/u);
    expect(css).not.toMatch(/@import\s+(?:url\(\s*)?["']?css-dep\//u);
    expect(css).not.toMatch(/@import[^;]*_zephyr/u);
  });

  test("展开进来的相对 url() 按**那份 CSS 的目录**解析：大的出资产地址、小的内联成 data URI", async () => {
    const products = await productsOf();
    const css = injectedCssOf(products);
    expect(css, "大文件按 threshold 产出 assets/…").toMatch(
      /\/_zephyr\/@modules\/@morlay\+css-host@2\.0\.0\/assets\/big-font-[A-Za-z0-9_-]+\.woff2/u,
    );
    expect(css, "小文件内联成 data URI").toContain("data:image/png;base64,");
    expect(css, "相对路径不再留在产物里").not.toContain("url(./fonts/big-font.woff2)");
  });
});

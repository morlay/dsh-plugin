/**
 * 产出的行为：联邦地址的形态，与"按请求触发、按包聚合"的缓存语义。
 *
 * 缓存那条最要紧：产物目录是**包级**的（出口各有自己的文件），而构建是按请求逐出口触发的——命中判据
 * 少了"这次要的出口在不在"，第二次请求的出口就会 404；构建之间不排队，并发请求会互相删掉对方的产物。
 *
 * 分组按**语义**：地址是纯函数（不构建）；缓存语义每条都要一次真实构建（构建本身就是被测动作）；
 * 入口形态共享**一个 fixture 包、一次构建、多个出口**（每条断言只读自己的产物，失败定位不受影响）。
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BUNDLER_REV, bundlePackage, clientModulesAlias, urlOf } from "@morlay/zephyr-app/testing";

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

test("子路径引用保留子路径；扩展名与产物一致（没有扩展名的补 `.js`，有的原样）", () => {
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
  expect(urlOf("katex/dist/katex.min.css", tables)).toBe(
    `/_zephyr/@modules/katex@0.16.47/dist/katex.min.css?v=${BUNDLER_REV}`,
  );
});

describe("缓存语义（按请求触发、按包聚合）", () => {
  let work: string;
  let cacheRoot: string;
  let packageRoot: string;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "dsh-bundle-"));
    cacheRoot = join(work, ".cache");
    packageRoot = join(work, "fixture");
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
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  function options(exportName: string): Parameters<typeof bundlePackage>[0] {
    return {
      nodeStub: join(dirname(fileURLToPath(import.meta.url)), "..", "node-stub", "node-stub.cjs"),
      cacheRoot,
      repoRoot: work,
      alias: clientModulesAlias({
        repoRoot,
        nodeStub: join(repoRoot, "packages/zephyr/zephyr-app/src/node-stub/node-stub.cjs"),
      }),
      name: "fixture",
      version: "1.0.0",
      input: { [exportName]: join(packageRoot, "src", `${exportName}.ts`) },
      watch: [join(packageRoot, "src")],
    };
  }

  test("按出口命中：先请求 a、再请求 b，b 不该被当成命中，且 a 的产物要留下", async () => {
    const first = await bundlePackage(options("a"));
    expect([...(first?.files.keys() ?? [])]).toEqual(["a"]);
    const second = await bundlePackage(options("b"));
    expect([...(second?.files.keys() ?? [])].sort()).toEqual(["a", "b"]);
    // 增量合并：a 的产物还在磁盘上（没被这次构建清掉）。
    const aFile = join(cacheRoot, first?.files.get("a") ?? "");
    await expect(stat(aFile)).resolves.toBeDefined();
  });

  test("再请求同一出口：命中缓存（产物的 mtime 不变）", async () => {
    const target = join(cacheRoot, "fixture@1.0.0", "a.js");
    await bundlePackage(options("a"));
    const before = await stat(target);
    // 这条不是等异步结果，而是等文件系统的 mtime 走到下一格——"命中缓存"与"又打了一遍"否则分不出来。
    await waitForMtimeTick();
    await bundlePackage(options("a"));
    expect((await stat(target)).mtimeMs).toBe(before.mtimeMs);
  });

  test("源码变了：指纹变、重打；但地址不裂成两个（内容变了靠协商缓存）", async () => {
    const tables = { versions: new Map([["fixture", "1.0.0"]]) };
    const beforeUrl = urlOf("fixture", tables);
    const first = await bundlePackage(options("a"));
    await appendFile(join(packageRoot, "src", "a.ts"), "export const a2 = 3;\n", "utf8");
    const second = await bundlePackage(options("a"));
    expect(second?.rev).not.toBe(first?.rev);
    expect(urlOf("fixture", tables), "URL 只随构建器规则变，不随内容变").toBe(beforeUrl);
  });

  test("装饰器在产物里必须已被转译，且**不依赖进程 cwd**", async () => {
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
  let work: string;
  let cacheRoot: string;
  let files: Map<string, string>;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "dsh-bundle-entries-"));
    cacheRoot = join(work, ".cache");
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
    files = bundled?.files ?? new Map<string, string>();
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  /** 某出口的产物绝对路径。 */
  function fileOf(exportName: string): string {
    return join(cacheRoot, files.get(exportName) ?? "");
  }

  test("CJS/UMD 入口：具名导出与 default 同时产出，保留字不写进 `export const`", async () => {
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
    const file = fileOf("esm");
    const code = await readFile(file, "utf8");
    expect(code, "ESM 不该被当成 CJS 补 default").not.toMatch(/export default/u);
    const loaded = (await import(pathToFileURL(file).href)) as { readonly Terminal?: unknown };
    expect(typeof loaded.Terminal).toBe("function");
  });

  test("`module` 字段指向的 `.js` 按 ESM 处理（`rrule` 的 `dist/esm/index.js` 就是这种）", async () => {
    // 老包没有 `type`、同时给 `main`（CJS）与 `module`（ESM）——出口落点决定"哪个文件"，
    // 扩展名/type 决定"那个文件是什么模块"。选到 ESM 那份就**不能**再 shim。
    expect(await readFile(fileOf("legacy"), "utf8")).not.toMatch(/export default/u);
  });

  test("扩展名即模块类型：`.mjs` / `.ts` 入口都不进 CJS 那条求值路径", async () => {
    expect(await readFile(fileOf("mjs"), "utf8")).not.toMatch(/export default/u);
    expect(await readFile(fileOf("ts"), "utf8")).not.toMatch(/export default/u);
  });
});

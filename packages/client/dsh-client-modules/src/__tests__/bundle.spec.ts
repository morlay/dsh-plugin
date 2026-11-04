/**
 * 产出的行为：联邦地址的形态，与"按请求触发、按包聚合"的缓存语义。
 *
 * 缓存那条最要紧：产物目录是**包级**的（出口各有自己的文件），而构建是按请求逐出口触发的——命中判据
 * 少了"这次要的出口在不在"，第二次请求的出口就会 404；构建之间不排队，并发请求会互相删掉对方的产物。
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BUNDLER_REV, bundlePackage, clientModulesAlias, moduleKindOf, urlOf } from "../bundle.ts";

const repoRoot = process.cwd();

test("CSS 出口：产出 CSS 文本（url() 资产改写 + 落 assets），不生成 JS", async () => {
  const pkg = join(work, "node_modules", "style-pkg");
  await mkdir(join(pkg, "dist"), { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    `${JSON.stringify({
      name: "style-pkg",
      version: "1.0.0",
      exports: { "./theme.css": "./dist/theme.css" },
    })}\n`,
    "utf8",
  );
  await writeFile(join(pkg, "dist", "theme.css"), ".icon { background: url(./dot.svg) }\n", "utf8");
  await writeFile(join(pkg, "dist", "dot.svg"), "<svg/>\n", "utf8");

  const bundled = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "style-pkg",
    version: "1.0.0",
    input: { "theme.css": join(pkg, "dist", "theme.css") },
    watch: [pkg],
  });
  const files = [...(bundled?.files.keys() ?? [])];
  expect(files).toContain("theme.css");
  const asset = files.find((file) => file.startsWith("assets/dot-"));
  expect(asset).toBeDefined();
  const css = await readFile(join(cacheRoot, bundled?.files.get("theme.css") ?? ""), "utf8");
  expect(css).toContain(`/@client-modules/style-pkg@1.0.0/${asset ?? ""}`);
  await expect(stat(join(cacheRoot, "style-pkg@1.0.0", "theme.css.js"))).rejects.toThrow();
  await expect(
    readFile(join(cacheRoot, bundled?.files.get(asset ?? "") ?? ""), "utf8"),
  ).resolves.toContain("<svg");
});

test("模块类型：扩展名 + 最近的 package.json（什么时候 ESM、什么时候 CJS）", async () => {
  const root = join(work, "kinds");
  await mkdir(join(root, "esm"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "kinds", version: "1.0.0", type: "commonjs" })}\n`,
    "utf8",
  );
  const touch = async (file: string): Promise<string> => {
    const path = join(root, file);
    await writeFile(path, "", "utf8");
    return path;
  };

  // 扩展名就能定。
  expect(await moduleKindOf(await touch("a.mjs"))).toBe("esm");
  expect(await moduleKindOf(await touch("a.mts"))).toBe("esm");
  expect(await moduleKindOf(await touch("a.cjs"))).toBe("cjs");
  expect(await moduleKindOf(await touch("a.cts"))).toBe("cjs");
  expect(await moduleKindOf(await touch("a.ts"))).toBe("source");
  expect(await moduleKindOf(await touch("a.tsx"))).toBe("source");
  expect(await moduleKindOf(await touch("a.css"))).toBe("style");
  expect(await moduleKindOf(await touch("a.png"))).toBe("asset");

  // `.js`：`type` 与**语法检测**（Node 的 `--experimental-detect-module`）。
  expect(await moduleKindOf(await touch("a.js"))).toBe("cjs");
  await writeFile(
    join(root, "esm", "package.json"),
    `${JSON.stringify({ name: "kinds-esm", version: "1.0.0", type: "module" })}\n`,
    "utf8",
  );
  expect(await moduleKindOf(await touch("esm/a.js"))).toBe("esm");

  const legacy = join(root, "legacy");
  await mkdir(join(legacy, "esm"), { recursive: true });
  await mkdir(join(legacy, "cjs"), { recursive: true });
  await writeFile(
    join(legacy, "package.json"),
    `${JSON.stringify({
      name: "kinds-legacy",
      version: "1.0.0",
      main: "cjs/index.js",
      module: "esm/index.js",
    })}\n`,
    "utf8",
  );
  // 没有 `type`：看源码里有没有 ESM 语法。
  await writeFile(join(legacy, "esm", "index.js"), "export const x = 1;\n", "utf8");
  await writeFile(join(legacy, "cjs", "index.js"), "module.exports = 1;\n", "utf8");
  expect(await moduleKindOf(join(legacy, "esm", "index.js"))).toBe("esm");
  expect(await moduleKindOf(join(legacy, "cjs", "index.js"))).toBe("cjs");

  // `type: "commonjs"` 时不做语法检测（Node 的规则：显式声明优先）。
  const forced = join(root, "forced-cjs");
  await mkdir(forced, { recursive: true });
  await writeFile(
    join(forced, "package.json"),
    `${JSON.stringify({ name: "forced-cjs", version: "1.0.0", type: "commonjs" })}\n`,
    "utf8",
  );
  await writeFile(join(forced, "index.js"), "export const x = 1;\n", "utf8");
  expect(await moduleKindOf(join(forced, "index.js"))).toBe("cjs");
});

test("包级引用的出口按「是不是行」分：行 → client.js，普通 npm 包 → 根出口 index.js", () => {
  const tables = {
    versions: new Map([
      ["@deepseek-ai/dsh-x", "1.2.3"],
      ["react", "18.3.1"],
    ]),
    // 行由 loader 给（`dsh.client` + client 半）；react 是普通 npm 包，不在里面。
    clientRows: new Set(["@deepseek-ai/dsh-x"]),
  };
  expect(urlOf("@deepseek-ai/dsh-x", tables)).toBe(
    `/@client-modules/@deepseek-ai+dsh-x@1.2.3/client.js?v=${BUNDLER_REV}`,
  );
  expect(urlOf("react", tables)).toBe(`/@client-modules/react@18.3.1/index.js?v=${BUNDLER_REV}`);
});

test("地址带 `?v=`（构建世代；与 vite 同名的参数）", () => {
  const tables = { versions: new Map([["react", "18.3.1"]]) };
  expect(urlOf("react", tables)).toBe(`/@client-modules/react@18.3.1/index.js?v=${BUNDLER_REV}`);
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
    `/@client-modules/@oxc-project+runtime@0.153.0/helpers/decorate.js?v=${BUNDLER_REV}`,
  );
  expect(urlOf("katex/dist/katex.min.css", tables)).toBe(
    `/@client-modules/katex@0.16.47/dist/katex.min.css?v=${BUNDLER_REV}`,
  );
});

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
  await writeFile(join(packageRoot, "src", "c.ts"), "export const c = 3;\n", "utf8");
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

function options(exportName: string): Parameters<typeof bundlePackage>[0] {
  return {
    cacheRoot,
    repoRoot: work,
    alias: clientModulesAlias({
      repoRoot,
      nodeStub: join(repoRoot, "packages/client/dsh-client-modules/app-boot/node-stub.cjs"),
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

test("已产出的出口再次请求：命中缓存，不重打（产物的 mtime 不变）", async () => {
  const target = join(cacheRoot, "fixture@1.0.0", "a.js");
  const before = await stat(target);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await bundlePackage(options("a"));
  const after = await stat(target);
  expect(after.mtimeMs).toBe(before.mtimeMs);
});

test("地址与产物内容无关：构建前后是同一个 URL（内容变了靠协商缓存，URL 不裂成两个）", async () => {
  const tables = { versions: new Map([["fixture", "1.0.0"]]) };
  const before = urlOf("fixture", tables);
  await bundlePackage(options("a"));
  expect(urlOf("fixture", tables)).toBe(before);
});

test("源码变了：指纹变、重打（且旧产物作废）", async () => {
  const first = await bundlePackage(options("a"));
  await appendFile(join(packageRoot, "src", "a.ts"), "export const a2 = 3;\n", "utf8");
  const second = await bundlePackage(options("a"));
  expect(second?.rev).not.toBe(first?.rev);
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

test("tsconfig 与 `transform.decorator` 都声明装饰器时不再提示冲突（语义相同，口径取 transform 那侧）", async () => {
  // 两处声明是必须的：tsconfig 那项管不到 `node_modules` 里的包（include 面默认排除它），transform 那侧才是
  // 保底。rolldown 的 `CONFIGURATION_FIELD_CONFLICT` 只是"重复声明"级提示，本链在 `onLog` 里过滤掉——
  // 这条用例钉住"过滤生效"，别让它哪天又冒出来。
  const warned: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warned.push(args.map(String).join(" "));
  };
  try {
    await bundlePackage({ ...options("c"), tsconfig: join(work, "tsconfig.json") });
  } finally {
    console.warn = original;
  }
  expect(warned.filter((line) => line.includes("CONFIGURATION_FIELD_CONFLICT"))).toEqual([]);
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
  // 包在 `work2/node_modules/…`（祖先链里没有 tsconfig），tsconfig 由 `resolve.tsconfigFilename` 显式指过去——
  // 外置/官方包在产物里的处境（`dshdev --prod` 的闭包面就是 node_modules 形态）。**装饰器由 transform 那一侧
  // 保底**（tsconfig 的 include 面默认排除 node_modules），这条用例同时钉住"指了 tsconfig 也不会把装饰器弄丢"。
  const elsewhere = join(work2, "..", `dsh-tsconfig-${String(Date.now())}`, "tsconfig.json");
  await mkdir(join(elsewhere, ".."), { recursive: true });
  await writeFile(
    elsewhere,
    `${JSON.stringify({ compilerOptions: { target: "esnext", experimentalDecorators: true } })}\n`,
    "utf8",
  );
  try {
    const bundled = await bundlePackage({
      cacheRoot: join(work2, ".cache"),
      repoRoot: work2,
      alias: [],
      name: "fixture",
      version: "1.0.0",
      input: { a: join(pkg2, "src", "a.ts") },
      watch: [join(pkg2, "src")],
      tsconfig: elsewhere,
    });
    const code = await readFile(join(join(work2, ".cache"), bundled?.files.get("a") ?? ""), "utf8");
    // 债已销：这条链改成 **rolldown 直出**（不再经 `vite build`），`resolve.tsconfigFilename` 才落到
    // rolldown 手里——外置/官方的包住在 `node_modules/.pnpm/…`、祖先链里没有 tsconfig，全靠这里指路。
    expect(code).not.toMatch(/@Remote/u);
  } finally {
    await rm(work2, { recursive: true, force: true });
    await rm(join(elsewhere, ".."), { recursive: true, force: true });
  }
});

test("CJS/UMD 入口（webpack 包装、局部名与导出名不同）：具名导出与 default 同时产出", async () => {
  // 三方包按 **node 的解析**取入口（`main`），老包（`rrule` / `@xterm/xterm` / `@xterm/addon-fit`）进来的
  // 就是 CJS/UMD——导出面是**运行期**的，rolldown 只能给出 `export default module.exports`。消费方还要
  // 具名导入（`import { Terminal } from '@xterm/xterm'`），所以入口求值后按键补成 `export const <键>`。
  //
  // 这里用 **webpack 风格 UMD**（`module.exports = factory()`）且局部名与导出名不同：产物里不能出现
  // `export default { FitAddon }` 这种引用裸导出名的写法——局部作用域里没有它，浏览器会报
  // `ReferenceError: FitAddon is not defined`（`@xterm/addon-fit@0.11.0` 真实踩到的就是这条）。
  const cjs = join(work, "cjs-entry");
  await mkdir(join(cjs, "dist"), { recursive: true });
  await writeFile(
    join(cjs, "package.json"),
    `${JSON.stringify({ name: "cjs-entry", version: "1.0.0", main: "dist/index.js" })}\n`,
    "utf8",
  );
  await writeFile(
    join(cjs, "dist", "index.js"),
    [
      "!function (root, factory) {",
      '  if (typeof exports === "object" && typeof module === "object") module.exports = factory();',
      '  else if (typeof define === "function" && define.amd) define([], factory);',
      "  else root.FitAddon = factory();",
      "}(globalThis, function () {",
      '  "use strict";',
      "  var t = {};",
      "  t.FitAddon = class FitAddon {};",
      // zod@4 的 CJS 面就有这种键：`export const function = …` 是语法错误，必须被剔掉。
      "  t.function = 1;",
      "  return t;",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const bundled = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "cjs-entry",
    version: "1.0.0",
    input: { index: join(cjs, "dist", "index.js") },
    watch: [join(cjs, "dist")],
  });
  const file = join(cacheRoot, bundled?.files.get("index") ?? "");
  const loaded = (await import(pathToFileURL(file).href)) as {
    readonly FitAddon?: unknown;
    readonly default?: { readonly FitAddon?: unknown };
  };
  // 两种写法都成立：具名导入（浏览器里 `import { FitAddon }`）与 default（Node/CJS 的 `module.exports`）。
  expect(typeof loaded.FitAddon).toBe("function");
  expect(typeof loaded.default?.FitAddon).toBe("function");

  // shim 只活在内存里（虚拟入口），缓存目录不落这个文件。
  await expect(stat(join(cacheRoot, "cjs-entry@1.0.0", "index.cjs-shim.mjs"))).rejects.toThrow();
  // 保留字不能出现在 `export const` 里（语法错误）。
  expect(await readFile(file, "utf8")).not.toMatch(/export const function\b/u);
});

test("有 ESM 入口的包：不生成 CJS shim（`zod@4` 那种 import/require 双支）", async () => {
  // 入口由清单的 `import` 条件选出（ESM），就交给 rolldown 直出；只有 node 求值确认是 CJS 的入口才包 shim。
  const esm = join(work, "dual-esm");
  await mkdir(join(esm, "dist"), { recursive: true });
  await writeFile(
    join(esm, "package.json"),
    `${JSON.stringify({
      name: "dual-esm",
      version: "1.0.0",
      type: "module",
      exports: { ".": { import: "./dist/index.js", require: "./dist/index.cjs" } },
    })}\n`,
    "utf8",
  );
  await writeFile(join(esm, "dist", "index.js"), "export const z = 1;\n", "utf8");
  await writeFile(join(esm, "dist", "index.cjs"), "module.exports = { z: 1 };\n", "utf8");

  const bundled = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "dual-esm",
    version: "1.0.0",
    input: { index: join(esm, "dist", "index.js") },
    watch: [join(esm, "dist")],
  });
  expect([...(bundled?.files.keys() ?? [])]).toEqual(["index"]);
  await expect(stat(join(cacheRoot, "dual-esm@1.0.0", "index.cjs-shim.mjs"))).rejects.toThrow();
});

test("ESM 入口：交给 rolldown 的具名导出，不补任何 default", async () => {
  // node 的 `require(esm)` 会返回命名空间（`[object Module]`）。这种入口不该被当成 CJS 包补 default：
  // rolldown 自己就能产出具名导出，硬补一个 `default = 命名空间` 只会多一个消费方不该依赖的面。
  const esm = join(work, "esm-entry");
  await mkdir(join(esm, "src"), { recursive: true });
  await writeFile(
    join(esm, "package.json"),
    `${JSON.stringify({ name: "esm-entry", version: "1.0.0", type: "module", main: "src/index.js" })}\n`,
    "utf8",
  );
  await writeFile(
    join(esm, "src", "index.js"),
    "const t = class {};\nexport { t as Terminal };\n",
    "utf8",
  );

  const bundled = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "esm-entry",
    version: "1.0.0",
    input: { index: join(esm, "src", "index.js") },
    watch: [join(esm, "src")],
  });
  const file = join(cacheRoot, bundled?.files.get("index") ?? "");
  const code = await readFile(file, "utf8");
  expect(code).not.toMatch(/export default/u);
  const loaded = (await import(pathToFileURL(file).href)) as { readonly Terminal?: unknown };
  expect(typeof loaded.Terminal).toBe("function");
});

test("exports 落点 + 扩展名/type：`.cjs` 才 shim，`.mjs` 与 `module` 字段指向的 `.js` 都不 shim", async () => {
  // 条件决定"哪个文件"，扩展名/type 决定"那个文件是什么模块"。两边都处理到，才是完整判定。
  const cond = join(work, "cond-entry");
  await mkdir(join(cond, "dist"), { recursive: true });
  await writeFile(
    join(cond, "package.json"),
    `${JSON.stringify({
      name: "cond-entry",
      version: "1.0.0",
      exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" } },
    })}\n`,
    "utf8",
  );
  await writeFile(join(cond, "dist", "index.mjs"), "export const esm = 1;\n", "utf8");
  await writeFile(join(cond, "dist", "index.cjs"), "module.exports = { cjs: 1 };\n", "utf8");

  const asCjs = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "cond-entry",
    version: "1.0.0",
    input: { index: join(cond, "dist", "index.cjs") },
    watch: [join(cond, "dist")],
  });
  expect(asCjs?.files.has("index")).toBe(true);
  const cjsLoaded = (await import(
    pathToFileURL(join(cacheRoot, asCjs?.files.get("index") ?? "")).href
  )) as { readonly cjs?: number; readonly default?: { readonly cjs?: number } };
  expect(cjsLoaded.cjs).toBe(1);
  expect(cjsLoaded.default?.cjs).toBe(1);

  // 换一个包名：缓存目录是**包级**的，同一个包的另一次构建不会删掉上一次的 shim。
  const esmPkg = join(work, "cond-esm");
  await mkdir(join(esmPkg, "dist"), { recursive: true });
  await writeFile(
    join(esmPkg, "package.json"),
    `${JSON.stringify({
      name: "cond-esm",
      version: "1.0.0",
      exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" } },
    })}\n`,
    "utf8",
  );
  await writeFile(join(esmPkg, "dist", "index.mjs"), "export const esm = 1;\n", "utf8");
  await writeFile(join(esmPkg, "dist", "index.cjs"), "module.exports = { cjs: 1 };\n", "utf8");
  const asEsm = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "cond-esm",
    version: "1.0.0",
    input: { index: join(esmPkg, "dist", "index.mjs") },
    watch: [join(esmPkg, "dist")],
  });
  expect(asEsm?.files.has("index")).toBe(true);
  // ESM 入口交给 rolldown 直出：没有 CJS shim 补出来的 default。
  expect(await readFile(join(cacheRoot, asEsm?.files.get("index") ?? ""), "utf8")).not.toMatch(
    /export default/u,
  );

  // 老包的 ESM 产物是 `.js`：`module` 字段指向的那份按 ESM 处理（`rrule` 的 dist/esm/index.js）。
  const legacy = join(work, "legacy-module");
  await mkdir(join(legacy, "esm"), { recursive: true });
  await mkdir(join(legacy, "cjs"), { recursive: true });
  await writeFile(
    join(legacy, "package.json"),
    `${JSON.stringify({
      name: "legacy-module",
      version: "1.0.0",
      main: "cjs/index.js",
      module: "esm/index.js",
    })}\n`,
    "utf8",
  );
  await writeFile(join(legacy, "esm", "index.js"), "export const esm = 1;\n", "utf8");
  await writeFile(join(legacy, "cjs", "index.js"), "module.exports = { cjs: 1 };\n", "utf8");
  const legacyEsm = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "legacy-module",
    version: "1.0.0",
    input: { index: join(legacy, "esm", "index.js") },
    watch: [join(legacy, "esm")],
  });
  expect(legacyEsm?.files.has("index")).toBe(true);
  expect(await readFile(join(cacheRoot, legacyEsm?.files.get("index") ?? ""), "utf8")).not.toMatch(
    /export default/u,
  );
});

test("扩展名即模块类型：`.mjs` / `.ts` 入口不生成 CJS shim", async () => {
  // `.mjs` 是 ESM，`.ts` 是源码面：都不该进 "CJS 具名导出" 那条求值路径。
  for (const [name, file, code, expected] of [
    ["ext-mjs", "index.mjs", "const t = class {};\nexport { t as Terminal };\n", "Terminal"],
    ["ext-ts", "index.ts", "export const x = 1;\n", "x"],
  ] as const) {
    const dir = join(work, name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({ name, version: "1.0.0", type: "module" })}\n`,
      "utf8",
    );
    await writeFile(join(dir, file), code, "utf8");
    const built = await bundlePackage({
      cacheRoot,
      repoRoot: work,
      alias: [],
      name,
      version: "1.0.0",
      input: { index: join(dir, file) },
      watch: [dir],
    });
    expect([...(built?.files.keys() ?? [])]).toEqual(["index"]);
    await expect(stat(join(cacheRoot, `${name}@1.0.0`, "index.cjs-shim.mjs"))).rejects.toThrow();
    const loaded = (await import(
      pathToFileURL(join(cacheRoot, built?.files.get("index") ?? "")).href
    )) as Record<string, unknown>;
    expect(loaded[expected]).toBeDefined();
  }
});

test("纯 ESM 的包不补 default（不掩盖真实的导出缺失）", async () => {
  const code = await readFile(join(cacheRoot, "fixture@1.0.0", "b.js"), "utf8");
  expect(code).not.toContain("export default");
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

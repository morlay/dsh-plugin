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
import { BUNDLER_REV, bundlePackage, clientModulesAlias, urlOf } from "../bundle.ts";

const repoRoot = process.cwd();

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

test("`main` 是 CJS、`module` 是 ESM 的双形态包：产物补出 default（Node 下那句 import 拿的就是 CJS 的 module.exports）", async () => {
  // `rrule` 就是这个形态：`main`（CJS）与 `module`（ESM，没有 default）导出面不同。浏览器里取的是 `module`，
  // 不补 default 的话，上游那句 `import rrulePackage from 'rrule'` 会报
  // `does not provide an export named 'default'`。
  const dual = join(work, "dual");
  await mkdir(join(dual, "dist", "cjs"), { recursive: true });
  await mkdir(join(dual, "dist", "esm"), { recursive: true });
  await writeFile(
    join(dual, "package.json"),
    `${JSON.stringify({
      name: "dual",
      version: "1.0.0",
      main: "dist/cjs/index.js",
      module: "dist/esm/index.js",
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(dual, "dist", "cjs", "index.js"),
    "module.exports = { alpha: 1, beta: 2 };\n",
    "utf8",
  );
  await writeFile(
    join(dual, "dist", "esm", "index.js"),
    "export const alpha = 1;\nexport const beta = 2;\n",
    "utf8",
  );

  const bundled = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: clientModulesAlias({
      repoRoot,
      nodeStub: join(repoRoot, "packages/client/dsh-client-modules/app-boot/node-stub.cjs"),
    }),
    name: "dual",
    version: "1.0.0",
    input: { index: join(dual, "dist", "esm", "index.js") },
    watch: [join(dual, "dist", "esm")],
  });
  const file = join(cacheRoot, bundled?.files.get("index") ?? "");
  const code = await readFile(file, "utf8");
  // rolldown 会把 `export default` 压成 `export { x as default }`，两种形态都算补上了。
  expect(code).toMatch(/\bas default\b|export default/u);

  const loaded = (await import(pathToFileURL(file).href)) as {
    readonly default: { readonly alpha?: number };
    readonly beta?: number;
  };
  // default 与 Node 下 CJS 的 `module.exports` 同形：键都在上面。
  expect(loaded.default.alpha).toBe(1);
  expect(loaded.beta).toBe(2);
});

test("双形态包的 ESM 入口自带 default 时不覆盖它（`jsbi` 那种：`export default JSBI`）", async () => {
  // 补 default 只对"ESM 入口没有 default"的那种包。`jsbi` 的 `module` 里有 `export default JSBI`，若也套上
  // 命名空间对象，`@js-temporal/polyfill` 的 `import e from "jsbi"` 就拿不到 JSBI 类，运行期报
  // `e.BigInt is not a function`。
  const dualDefault = join(work, "dual-default");
  await mkdir(join(dualDefault, "dist", "cjs"), { recursive: true });
  await mkdir(join(dualDefault, "dist", "esm"), { recursive: true });
  await writeFile(
    join(dualDefault, "package.json"),
    `${JSON.stringify({
      name: "dual-default",
      version: "1.0.0",
      main: "dist/cjs/index.js",
      module: "dist/esm/index.js",
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(dualDefault, "dist", "cjs", "index.js"),
    "module.exports = { other: 1 };\n",
    "utf8",
  );
  await writeFile(
    join(dualDefault, "dist", "esm", "index.js"),
    "const marker = { own: true };\nexport const other = 1;\nexport default marker;\n",
    "utf8",
  );

  const bundled = await bundlePackage({
    cacheRoot,
    repoRoot: work,
    alias: [],
    name: "dual-default",
    version: "1.0.0",
    input: { index: join(dualDefault, "dist", "esm", "index.js") },
    watch: [join(dualDefault, "dist", "esm")],
  });
  const file = join(cacheRoot, bundled?.files.get("index") ?? "");
  const loaded = (await import(pathToFileURL(file).href)) as {
    readonly default: { readonly own?: boolean; readonly other?: number };
  };
  // 包自己的 default（不是命名空间对象：命名空间上没有 `own`、倒是有 `other`）。
  expect(loaded.default.own).toBe(true);
  expect(loaded.default.other).toBeUndefined();
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

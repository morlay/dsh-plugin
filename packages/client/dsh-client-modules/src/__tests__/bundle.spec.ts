/**
 * 产出的行为：联邦地址的形态，与"按请求触发、按包聚合"的缓存语义。
 *
 * 缓存那条最要紧：产物目录是**包级**的（出口各有自己的文件），而构建是按请求逐出口触发的——命中判据
 * 少了"这次要的出口在不在"，第二次请求的出口就会 404；构建之间不排队，并发请求会互相删掉对方的产物。
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("子路径引用保留子路径，不自作主张加 `.js`", () => {
  const tables = { versions: new Map([["@oxc-project/runtime", "0.153.0"], ["katex", "0.16.47"]]) };
  expect(urlOf("@oxc-project/runtime/helpers/decorate", tables)).toBe(
    `/@client-modules/@oxc-project+runtime@0.153.0/helpers/decorate?v=${BUNDLER_REV}`,
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
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

function options(exportName: string): Parameters<typeof bundlePackage>[0] {
  return {
    cacheRoot,
    repoRoot: work,
    alias: clientModulesAlias({ repoRoot, nodeStub: join(repoRoot, "packages/client/dsh-client-modules/app-boot/node-stub.cjs") }),
    name: "fixture",
    version: "1.0.0",
    input: { [exportName]: join(packageRoot, "src", `${exportName}.ts`) },
    watch: [join(packageRoot, "src")],
    declaredDependencies: ["zod"],
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
      cacheRoot: join(work2, ".cache"),
      repoRoot: work2,
      alias: [],
      name: "fixture",
      version: "1.0.0",
      input: { a: join(pkg2, "src", "a.ts") },
      watch: [join(pkg2, "src")],
      declaredDependencies: [],
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

/**
 * 产出的行为：联邦地址的形态，与"按请求触发、按包聚合"的缓存语义。
 *
 * 缓存那条最要紧：产物目录是**包级**的（出口各有自己的文件），而构建是按请求逐出口触发的——命中判据
 * 少了"这次要的出口在不在"，第二次请求的出口就会 404；构建之间不排队，并发请求会互相删掉对方的产物。
 */
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BUNDLER_REV, bundlePackage, clientModulesAlias, urlOf } from "../bundle.ts";

const repoRoot = process.cwd();

test("包级引用走出口表（有 `./client` 的包指 client，否则根出口）", () => {
  const tables = { versions: new Map([["@deepseek-ai/dsh-x", "1.2.3"]]), exportsOf: new Map([["@deepseek-ai/dsh-x", "client"]]) };
  expect(urlOf("@deepseek-ai/dsh-x", tables)).toBe(
    `/@client-modules/@deepseek-ai+dsh-x@1.2.3/client.js?v=${BUNDLER_REV}`,
  );
  expect(urlOf("react", tables)).toBe(`/@client-modules/react@0.0.0/index.js?v=${BUNDLER_REV}`);
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
  await writeFile(join(packageRoot, "src", "a.ts"), "export const a = 1;\n", "utf8");
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

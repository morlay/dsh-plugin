// 转译器**注入**的 helper（`@oxc-project/runtime/helpers/decorate`）必须进产物。
//
// 它不是源码里的依赖：legacy 装饰器由 rolldown 的 oxc 降级时现写进去一条 import。发布包一个都没声明它，
// 所以外置的产物装到严格 `node_modules` 里直接 `Cannot find package '@oxc-project/runtime'`。
// 判据落在产物上——真跑一次 rolldown，再用**真正的 node 进程**加载那份产物：
// ① 产物里没有这条裸导入；② 装不到它就加载不动（对照组证明 fixture 真的走了这条注入）。
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";
import { hostBuildOptions, INJECTED_RUNTIME, isInlinedPackage } from "../compile.ts";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// 装饰器的 legacy 开关只从 tsconfig 读；rolldown 按 `cwd` 往上找，所以 fixture 自带一份。
const TSCONFIG = {
  compilerOptions: {
    experimentalDecorators: true,
    target: "es2022",
    useDefineForClassFields: false,
  },
};

const ENTRY = `function stamp(): ClassDecorator {
  return (target) => {
    Reflect.set(target, "stamped", true);
  };
}

@stamp()
export class Decorated {}
`;

// fixture：一份用 legacy 装饰器的源码 + 它自己的 tsconfig。
async function makeFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "devkit-injected-runtime-"));
  created.push(directory);
  await writeFile(join(directory, "tsconfig.json"), `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  await writeFile(join(directory, "index.ts"), ENTRY);
  return directory;
}

// 打一次 fixture：不传 `external` 就走构建自己的那份规则；传了则换成对照组的规则。
async function buildFixture(
  directory: string,
  external?: (id: string) => boolean | undefined,
): Promise<string> {
  const options = hostBuildOptions({
    name: "@local/devkit-injected-runtime-fixture",
    input: { index: join(directory, "index.ts") },
    cwd: directory,
  });
  const bundle = await rolldown(external === undefined ? options : { ...options, external });
  try {
    await bundle.write({
      dir: join(directory, "dist"),
      format: "esm",
      entryFileNames: "[name].mjs",
      chunkFileNames: "[name]-[hash].mjs",
      sourcemap: false,
    });
  } finally {
    await bundle.close();
  }
  return join(directory, "dist", "index.mjs");
}

/** 产物里的裸导入（`from "x"` / `import "x"`）；相对路径与 node 内建不算。 */
async function bareImportsOf(entry: string): Promise<string[]> {
  const directory = join(entry, "..");
  const found = new Set<string>();
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".mjs")) continue;
    const code = await readFile(join(directory, file), "utf8");
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
      const specifier = match[1];
      if (specifier === undefined || specifier.startsWith(".") || specifier.startsWith("node:")) {
        continue;
      }
      found.add(specifier);
    }
  }
  return [...found];
}

/**
 * 用真正的 node 进程加载一份产物，返回它的 stderr（空串 = 加载成功）。
 *
 * 不走 vitest 的 `import()`：测试进程的解析面比 node 宽（本仓 `node_modules/.pnpm` 里就躺着一份
 * `@oxc-project/runtime`），在那里「能加载」不代表发布态能加载。
 */
async function importInNode(entry: string): Promise<string> {
  const script = `await import(${JSON.stringify(pathToFileURL(entry).href)});`;
  try {
    await new Promise<void>((done, fail) => {
      // 空白环境：vitest 的 worker 带着 `NODE_PATH`（指进 `.pnpm/node_modules`，那里躺着一份
      // `@oxc-project/runtime`）与 `NODE_OPTIONS`（`@oxc-node/core/register` 会替它接住裸导入），
      // 继承下来就永远判不出「装不到」。
      execFile(
        process.execPath,
        ["--input-type=module", "-e", script],
        { env: {} },
        (error, _stdout, stderr) => (error === null ? done() : fail(new Error(stderr))),
      );
    });
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("转译器注入的 helper 内联进产物", () => {
  it("注入的包按包名与子路径都命中内联名单", () => {
    expect(isInlinedPackage("@oxc-project/runtime/helpers/decorate", INJECTED_RUNTIME)).toBe(true);
    expect(isInlinedPackage("@oxc-project/runtime", INJECTED_RUNTIME)).toBe(true);
    expect(isInlinedPackage("@oxc-project/runtime-other/helpers/decorate", INJECTED_RUNTIME)).toBe(
      false,
    );
  });

  it("host 面产物里没有对 @oxc-project/runtime 的裸导入，装不到它也能加载", async () => {
    // 走构建自己的那份规则（不另写一份 external），产物才代表 `devkit build` 的产物。
    const entry = await buildFixture(await makeFixture());

    expect(await bareImportsOf(entry)).toEqual([]);
    expect(await importInNode(entry)).toBe("");
  });

  it("对照：同一条注入被外置时，加载直接 Cannot find package", async () => {
    const directory = await makeFixture();
    const entry = await buildFixture(directory, () => true);

    expect(await bareImportsOf(entry)).toEqual(["@oxc-project/runtime/helpers/decorate"]);
    expect(await importInNode(entry)).toContain("Cannot find package '@oxc-project/runtime'");
  });
});

// 源码面的转译器只有一处事实：部署侧注入（`DSH_SOURCE_LOADER`、`--import`、`NODE_OPTIONS`），
// 注入的东西是本仓库的 `@morlay/dsh-oxc-node`。上游那些「子进程 / Worker 自己挂 tsx」的注入点
// 由 `vendor/patches/source-loader.patch` 统一改掉——本仓库不装 tsx，回落只会让子进程起不来。
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { bootstrapArgs } from "../../../../vendor/deepseek-harness/packages/ptc-runtime/ptc-runtime-node/src/launch.ts";
import { spawnRunnerInvocation } from "../../../../vendor/deepseek-harness/packages/subprocess/subprocess-local/src/runner-launch.ts";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const runNode = promisify(execFile);

/** 上游产品面的源码启动点（与 `vendor/patches/source-loader.patch` 一一对应）。 */
const INJECTION_POINTS = [
  "packages/subprocess/subprocess-local/src/runner-launch.ts",
  "packages/experimental/liveshare/src/host/tunnel-supervision.ts",
  "packages/experimental/speech-to-text-sensevoice/src/recognizer.ts",
  "packages/host/directory-picker-native/src/win32-dialog-host.ts",
  "packages/experimental/browser-use-stagehand-native/src/worker-client.ts",
  "packages/experimental/inspector/src/host/bridge/controller.ts",
  "packages/boot/plugin-market/src/parse-thread.ts",
] as const;

function source(path: string): Promise<string> {
  return readFile(`${repoRoot}vendor/deepseek-harness/${path}`, "utf8");
}

describe("源码面的转译器注入", () => {
  it("上游的源码启动点不再自己挂 tsx，一律从部署侧取", async () => {
    for (const point of INJECTION_POINTS) {
      const text = await source(point);
      expect(text, point).not.toMatch(/tsx\/(?:esm|cjs)/u);
      expect(text, point).toContain("sourceLoaderArgv");
    }
  });

  it("工作区与工具链的运行时入口都是本仓库的 oxc-node", async () => {
    for (const workspace of ["pnpm-workspace.yaml", "scripts/pnpm-workspace.yaml"]) {
      const text = await readFile(`${repoRoot}${workspace}`, "utf8");
      expect(text, workspace).toContain("--import @morlay/dsh-oxc-node");
      expect(text, workspace).not.toContain("@oxc-node/core");
    }
  });

  it("dev 形态把同一份转译器传给子进程", async () => {
    const text = await readFile(`${repoRoot}devpackages/dshdev/src/cli/dev.ts`, "utf8");
    expect(text).toContain("DSH_SOURCE_LOADER");
  });

  it("subprocess runner 用注入的 loader，而不是上游的默认值", () => {
    const previous = process.env.DSH_SOURCE_LOADER;
    process.env.DSH_SOURCE_LOADER = "/tmp/dsh-test-loader.mjs";
    try {
      const invocation = spawnRunnerInvocation();
      expect(invocation.slice(1, 3)).toEqual(["--import", "/tmp/dsh-test-loader.mjs"]);
      expect(invocation.at(-1)).toMatch(/subprocess-local\/src\/bin\.ts$/u);
    } finally {
      if (previous === undefined) delete process.env.DSH_SOURCE_LOADER;
      else process.env.DSH_SOURCE_LOADER = previous;
    }
  });

  it("绕缓存的查询串不会绕过转译", async () => {
    // tsdown 的 `import-without-cache`、vite 的 `?t=` 都会给 URL 加查询串：转译器看路径，
    // 漏掉这些就是 `TypeScript parameter property is not supported in strip-only mode`。
    const dir = await mkdtemp(join(tmpdir(), "dsh-oxc-node-"));
    try {
      const file = join(dir, "with-parameter-property.ts");
      await writeFile(
        file,
        "class Box { constructor(private readonly value: string) {} read(): string { return this.value } }\nexport const box = new Box('ok')\n",
        "utf8",
      );
      const url = `${pathToFileURL(file).href}?no-cache=${randomUUID()}`;
      const loader = fileURLToPath(import.meta.resolve("@morlay/dsh-oxc-node"));
      const { stdout } = await runNode(process.execPath, [
        "--import",
        loader,
        "--input-type=module",
        "-e",
        `const module = await import(${JSON.stringify(url)}); process.stdout.write(module.box.read())`,
      ]);
      expect(stdout).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("PTC 的源码子进程自带 loader：清空 host env 后仍能转译 node_modules 里的 .ts", async () => {
    // PTC worker 会把 host 环境整体清掉（只留启动白名单），`NODE_OPTIONS` 里的 loader 传不进去，
    // 所以在 argv 里固定一份；否则子进程 import 安装目录 node_modules 下的 .ts 直接
    // `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`（code run failed / worker-exit）。
    const previous = process.env.DSH_SOURCE_LOADER;
    const loader = fileURLToPath(import.meta.resolve("@morlay/dsh-oxc-node"));
    process.env.DSH_SOURCE_LOADER = loader;
    const dir = await mkdtemp(join(tmpdir(), "dsh-ptc-loader-"));
    try {
      await mkdir(join(dir, "node_modules", "fixture"), { recursive: true });
      const file = join(dir, "node_modules", "fixture", "lib.ts");
      await writeFile(
        file,
        "class Box { constructor(private readonly value: string) {} read(): string { return this.value } }\nexport const box = new Box('ok')\n",
        "utf8",
      );
      const argv = bootstrapArgs(
        { processPathFromHostPath: (path: string) => path },
        { kind: "node-script", executable: process.execPath },
        4096,
      );
      expect(argv.slice(0, 2)).toEqual(["--import", loader]);
      const { stdout } = await runNode(
        process.execPath,
        [
          ...argv.slice(0, 2),
          "--input-type=module",
          "-e",
          `const module = await import(${JSON.stringify(pathToFileURL(file).href)}); process.stdout.write(module.box.read())`,
        ],
        { env: { PATH: process.env.PATH } },
      );
      expect(stdout).toBe("ok");
    } finally {
      if (previous === undefined) delete process.env.DSH_SOURCE_LOADER;
      else process.env.DSH_SOURCE_LOADER = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

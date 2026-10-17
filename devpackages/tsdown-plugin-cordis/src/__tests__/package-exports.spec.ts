// 出口清单的**写回行为**：`publish-exports.spec.ts` 守的是已提交的清单，这里守生成它的那一步。
//
// 判据一句话：client 出口的两个条件各指一份产物——`import` 指 **ESM 库**（按 ESM 解析的消费方拿它当普通
// 库用），`default` 兜底指 **CJS 工厂**（`__ModuleLoader__.load` 的注册脚本：按包名 + `./client` 解析
// 并读字节的加载方走的正是这条兜底链）。
//
// 另有一条判据同时被三条用例覆盖：写回内容不该取决于「哪一轮构建先攒齐产物」——库与工厂两份都齐了才写，
// 且写出的永远是同一份 `./client`。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageExportsHook, writePackageManifest } from "../package-exports.ts";

type BuildDoneContext = Parameters<ReturnType<typeof packageExportsHook>>[0];

// 一个入口的产物：声明块的名字是 `<入口名>.d`，运行时是 `<入口名>`。
function artifacts(files: readonly string[]): { name: string; fileName: string }[] {
  return files.map((fileName) => ({
    name: fileName.replace(/\.d\.(m|c)?ts$/u, ".d").replace(/\.(m|c)?js$/u, ""),
    fileName,
  }));
}

function context(files: readonly string[]): BuildDoneContext {
  return {
    chunks: artifacts(files).map(({ name, fileName }) => ({
      type: "chunk",
      isEntry: true,
      name,
      fileName,
    })),
    options: { outDir: "dist" },
  } as unknown as BuildDoneContext;
}

const ENTRIES = {
  index: "./src/index.ts",
  rows: "./src/rows.ts",
  client: "./src/client/index.ts",
} as const;

// tsdown 的两轮产物（esm 一轮、cjs 一轮）：host 面等 ESM；client 面等**库与工厂两份都齐**。
const ALL_ARTIFACTS = [
  "index.mjs",
  "rows.mjs",
  "client.mjs",
  "client.d.mts",
  "index.cjs",
  "rows.cjs",
  "client.cjs",
] as const;

// 只有 ESM 那一轮：host 面齐了，client 面的 CJS 工厂还没落位。
const ESM_ROUND = ["index.mjs", "rows.mjs", "client.mjs", "client.d.mts"] as const;

const created: string[] = [];

async function makePackage(extra: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dsh-devkit-package-exports-"));
  created.push(directory);
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "@morlay/devkit-exports-fixture", private: true, type: "module", ...extra }, null, 2)}\n`,
  );
  return directory;
}

async function manifestOf(directory: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

async function publishedClient(directory: string): Promise<unknown> {
  const manifest = await manifestOf(directory);
  return (manifest["publishConfig"] as { exports?: Record<string, unknown> } | undefined)
    ?.exports?.["./client"];
}

// 临时目录是 fixture；`runs` 按 cwd 记录构建轮次，所以每条用例换一个目录，互不串。
async function write(directory: string, rounds: readonly (readonly string[])[]): Promise<void> {
  const hook = packageExportsHook({ entries: ENTRIES, clientEntry: "client" });
  const cwd = process.cwd();
  process.chdir(directory);
  try {
    // 多格式构建分多轮进这个钩子（esm 一轮、cjs 一轮）。
    for (const files of rounds) await hook(context(files));
  } finally {
    process.chdir(cwd);
  }
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// 范围由构建环境推导，所以每条相关用例自己摆 env，跑完收拾干净。
async function withHarnessVersion(version: string | undefined, run: () => Promise<void>) {
  if (version !== undefined) process.env["DEEPSEEK_HARNESS_VERSION"] = version;
  try {
    await run();
  } finally {
    delete process.env["DEEPSEEK_HARNESS_VERSION"];
  }
}

describe("packageExportsHook 写回的 client 出口", () => {
  it("两轮产物都齐时：`import` 指 ESM 库、`default` 兜底指 CJS 工厂", async () => {
    const directory = await makePackage();
    await write(directory, [ALL_ARTIFACTS]);
    expect(await publishedClient(directory)).toEqual({
      types: "./dist/client.d.mts",
      import: "./dist/client.mjs",
      default: "./dist/client.cjs",
    });
  });

  it("CJS 轮先到、ESM 轮才攒齐时：形态与一轮就齐时相同（写回不取决于哪一轮先到）", async () => {
    const directory = await makePackage();
    await write(directory, [
      // tsdown 的两轮里 cjs 先到：这一轮 host 面还没有 ESM 产物，写回推迟。
      ["index.cjs", "rows.cjs", "client.cjs"],
      // esm 轮到齐（run 里此时累积了两轮的产物，client 既有工厂也有库）。
      ESM_ROUND,
    ]);
    expect(await publishedClient(directory)).toEqual({
      types: "./dist/client.d.mts",
      import: "./dist/client.mjs",
      default: "./dist/client.cjs",
    });
  });

  it("ESM 轮已到、CJS 轮未到时也推迟：`default` 指的工厂还没落位", async () => {
    const directory = await makePackage();
    await write(directory, [ESM_ROUND]);
    expect(await publishedClient(directory)).toBeUndefined();
  });
});

describe("packageExportsHook 写回的 dsh 版本要求", () => {
  const BUNDLE = { dsh: { bundle: { patch: "./cordis.patch.yml" } } };

  it("bundle 包：engines.dsh 由 DEEPSEEK_HARNESS_VERSION 推导（当前版本到下一个 patch）", async () => {
    const directory = await makePackage(BUNDLE);
    await withHarnessVersion("0.2.1-alpha.5", async () => {
      await write(directory, [ALL_ARTIFACTS]);
    });
    expect((await manifestOf(directory))["engines"]).toEqual({
      dsh: ">= 0.2.1-alpha.5 < 0.2.2",
    });
  });

  it("已有 engines 的其它键保留（只加 dsh 这一条）", async () => {
    const directory = await makePackage({ ...BUNDLE, engines: { node: ">=22" } });
    await withHarnessVersion("0.1.7-rc.1", async () => {
      await write(directory, [ALL_ARTIFACTS]);
    });
    expect((await manifestOf(directory))["engines"]).toEqual({
      node: ">=22",
      dsh: ">= 0.1.7-rc.1 < 0.1.8",
    });
  });

  it("不是 bundle 的包不写（engines 不是每一层的要求）", async () => {
    const directory = await makePackage();
    await withHarnessVersion("0.2.1-alpha.5", async () => {
      await write(directory, [ALL_ARTIFACTS]);
    });
    expect((await manifestOf(directory))["engines"]).toBeUndefined();
  });

  it("env 缺失或认不出该形态时不写（清单原值留着，构建不因此失败）", async () => {
    for (const version of [undefined, "", "workspace:*", "vendor/deepseek-harness"]) {
      const directory = await makePackage(BUNDLE);
      await withHarnessVersion(version, async () => {
        await write(directory, [ALL_ARTIFACTS]);
      });
      expect((await manifestOf(directory))["engines"], String(version)).toBeUndefined();
    }
  });
});

// 没有源码入口的数据包（`dsh.bundle` 的纯数据包只有 patch / locale / icon）进不了 `build:done`，
// 但清单口径得和别的包同一份——它走的入口与钩子共用同一个写回实现。
describe("writePackageManifest（数据包的写回入口）", () => {
  it("固定面按文件存在性补，engines.dsh 照写", async () => {
    const directory = await makePackage({ dsh: { bundle: { patch: "./cordis.patch.yml" } } });
    await writeFile(join(directory, "cordis.patch.yml"), "# patch\n");
    await mkdir(join(directory, "locale"), { recursive: true });
    await writeFile(join(directory, "locale", "en.json"), "{}\n");
    await withHarnessVersion("0.2.1-alpha.5", async () => {
      await writePackageManifest(directory);
    });

    const manifest = await manifestOf(directory);
    const faces = {
      "./package.json": "./package.json",
      "./cordis.patch.yml": "./cordis.patch.yml",
      "./locale/*.json": "./locale/*.json",
    };
    expect(manifest["exports"]).toEqual(faces);
    expect(manifest["publishConfig"]).toEqual({ exports: faces });
    expect(manifest["engines"]).toEqual({ dsh: ">= 0.2.1-alpha.5 < 0.2.2" });
  });
});

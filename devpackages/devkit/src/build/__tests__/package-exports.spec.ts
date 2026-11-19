// 出口清单的**写回行为**：从构建结果（入口 → 产物文件）推导 `exports` / `publishConfig.exports`，
// 并按 `private` 分档。判据是「产物齐了写什么、private 写不写发布态」。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeBuildManifest, writePackageManifest } from "../package-exports.ts";

const ENTRIES = {
  index: "./src/index.ts",
  rows: "./src/rows.ts",
  client: "./src/client/index.ts",
};

const ARTIFACTS = {
  index: ["index.mjs"],
  rows: ["rows.mjs"],
  client: ["client.mjs", "client.cjs"],
};

const created: string[] = [];

async function makePackage(extra: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "devkit-package-exports-"));
  created.push(directory);
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "@local/devkit-exports-fixture", private: false, type: "module", ...extra }, null, 2)}\n`,
  );
  return directory;
}

async function manifestOf(directory: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

async function withHarnessVersion(version: string | undefined, run: () => Promise<void>) {
  if (version !== undefined) process.env["DEEPSEEK_HARNESS_VERSION"] = version;
  try {
    await run();
  } finally {
    delete process.env["DEEPSEEK_HARNESS_VERSION"];
  }
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("client 出口", () => {
  it("发布态只有 CJS 工厂（dsh 读字节的那份），顶层 exports 不含", async () => {
    const directory = await makePackage();
    await writeBuildManifest(directory, {
      entries: ENTRIES,
      artifacts: ARTIFACTS,
      clientEntry: "client",
    });
    const manifest = await manifestOf(directory);
    const published = (manifest["publishConfig"] as { exports?: Record<string, unknown> }).exports;
    expect(published?.["./client"]).toEqual({ default: "./dist/client.cjs" });
    expect((manifest["exports"] as Record<string, unknown>)["."]).toBe("./src/index.ts");
  });
});

describe("private 分档", () => {
  it("private 包只写 exports，不写 publishConfig / engines.dsh", async () => {
    const directory = await makePackage({ private: true });
    await withHarnessVersion("0.2.1-alpha.5", async () => {
      await writeBuildManifest(directory, { entries: ENTRIES, artifacts: ARTIFACTS });
    });
    const manifest = await manifestOf(directory);
    expect(manifest["publishConfig"]).toBeUndefined();
    expect(manifest["engines"]).toBeUndefined();
    expect((manifest["exports"] as Record<string, unknown>)["."]).toBe("./src/index.ts");
  });

  it("public 包写发布态清单与 engines.dsh", async () => {
    const directory = await makePackage();
    await withHarnessVersion("0.2.1-alpha.5", async () => {
      await writeBuildManifest(directory, { entries: ENTRIES, artifacts: ARTIFACTS });
    });
    const manifest = await manifestOf(directory);
    expect(manifest["publishConfig"]).toBeDefined();
    expect((manifest["engines"] as { dsh?: string }).dsh).toBe(">= 0.2.1-alpha.5 < 0.2.2");
  });
});

describe("只发布态入口", () => {
  it("publishOnly 入口只进 publishConfig，顶层 exports 不含", async () => {
    const directory = await makePackage();
    await writeBuildManifest(directory, {
      entries: ENTRIES,
      artifacts: ARTIFACTS,
      publishOnly: ["rows"],
    });
    const manifest = await manifestOf(directory);
    const dev = manifest["exports"] as Record<string, unknown>;
    expect(dev["./rows"]).toBeUndefined();
    const published = (manifest["publishConfig"] as { exports?: Record<string, unknown> }).exports;
    expect(published?.["./rows"]).toBe("./dist/rows.mjs");
  });
});

describe("没有产物形态的出口", () => {
  it("样式 / 资产出口原样进发布态，源码面的漏产物不被抄成源码路径", async () => {
    const directory = await makePackage({
      exports: {
        ".": "./src/index.ts",
        "./brand-font.css": "./src/styles/brand-font.css",
        "./missing": "./src/missing.ts",
      },
    });
    await writeBuildManifest(directory, {
      entries: { index: "./src/index.ts", missing: "./src/missing.ts" },
      artifacts: { index: ["index.mjs"] },
    });
    const manifest = await manifestOf(directory);
    const published = (manifest["publishConfig"] as { exports?: Record<string, unknown> }).exports;
    expect(published?.["./brand-font.css"]).toBe("./src/styles/brand-font.css");
    expect(published?.["."]).toBe("./dist/index.mjs");
    expect(published?.["./missing"]).toBeUndefined();
  });
});

describe("bundle patch", () => {
  it("行声明的 id / disabled / config 落成 patch，清单写 dsh.bundle.patch", async () => {
    const directory = await makePackage();
    await writeBuildManifest(directory, {
      entries: ENTRIES,
      artifacts: ARTIFACTS,
      bundle: { rows: [{ id: "session-store", disabled: true, config: { backend: "rdb" } }] },
    });
    const patch = await readFile(join(directory, "dist", "cordis.patch.yml"), "utf8");
    expect(patch).toContain("- id: session-store");
    expect(patch).toContain("disabled: true");
    expect(patch).toContain('config: {"backend":"rdb"}');
    const manifest = await manifestOf(directory);
    expect(manifest["dsh"]).toEqual({ bundle: { patch: "./dist/cordis.patch.yml" } });
    // patch 是发布产物：只在发布态清单里。
    expect((manifest["exports"] as Record<string, unknown>)["."]).toBe("./src/index.ts");
    expect((manifest["exports"] as Record<string, unknown>)["./cordis.patch.yml"]).toBeUndefined();
  });
});

describe("writePackageManifest（数据包）", () => {
  it("固定面按文件存在性补，engines.dsh 照写", async () => {
    const directory = await makePackage({ dsh: { bundle: { patch: "./cordis.patch.yml" } } });
    await writeFile(join(directory, "cordis.patch.yml"), "# patch\n");
    await mkdir(join(directory, "locale"), { recursive: true });
    await writeFile(join(directory, "locale", "en.json"), "{}\n");
    await withHarnessVersion("0.2.1-alpha.5", async () => {
      await writePackageManifest(directory);
    });
    const manifest = await manifestOf(directory);
    // patch 是发布产物（只进发布态）；locale 就在包根，顶层照列。
    expect(manifest["exports"]).toEqual({
      "./package.json": "./package.json",
      "./locale/*.json": "./locale/*.json",
    });
    expect(manifest["publishConfig"]).toEqual({
      exports: {
        "./package.json": "./package.json",
        "./cordis.patch.yml": "./cordis.patch.yml",
        "./locale/*.json": "./locale/*.json",
      },
    });
    expect(manifest["engines"]).toEqual({ dsh: ">= 0.2.1-alpha.5 < 0.2.2" });
  });
});

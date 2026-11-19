// 入口推导：`exports` / `bin` / `main` 怎么变成构建入口。判据是「哪些面有产物、哪些面只是源码直连」。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planOf } from "../compile.ts";

const created: string[] = [];

async function makePackage(manifest: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "devkit-plan-"));
  created.push(directory);
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "@local/devkit-plan-fixture", type: "module", ...manifest }, null, 2)}\n`,
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("planOf", () => {
  it("样式与资产出口不打包，其余按出口键建入口", async () => {
    const directory = await makePackage({
      exports: {
        ".": "./src/index.ts",
        "./ui": "./src/ui/index.ts",
        "./federation/prebundle": "./src/federation/prebundle.ts",
        "./brand-font.css": "./src/styles/brand-font.css",
        "./assets/*": "./src/assets/*",
        "./package.json": "./package.json",
      },
    });
    const plan = await planOf(directory);
    expect(plan.entries).toEqual({
      index: "./src/index.ts",
      ui: "./src/ui/index.ts",
      "federation/prebundle": "./src/federation/prebundle.ts",
    });
    expect(plan.hidden).toEqual([]);
  });

  it("非 bundle 包的 ./client 是普通 ESM 入口；bundle 包的另算", async () => {
    const plain = await makePackage({
      exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
    });
    expect((await planOf(plain)).entries["client"]).toBe("./src/client/index.ts");

    const bundle = await makePackage({
      exports: {
        ".": "./src/index.ts",
        "./ui": "./src/ui/index.ts",
        "./dsh-bundle": "./src/dsh-bundle.ts",
      },
    });
    const plan = await planOf(bundle);
    expect(plan.entries["client"]).toBeUndefined();
    expect(plan.client).toEqual({ source: "./src/ui/index.ts" });
    expect(plan.bundle).toBe(true);
    expect(plan.publishOnly).toEqual(["dsh-bundle"]);
  });

  it("bin 目标建隐藏入口（不进出口面）", async () => {
    const directory = await makePackage({
      exports: { ".": "./src/index.ts" },
      bin: { zephyr: "./src/cli.ts" },
    });
    const plan = await planOf(directory);
    expect(plan.entries).toEqual({ index: "./src/index.ts", cli: "./src/cli.ts" });
    expect(plan.hidden).toEqual(["cli"]);
    expect(plan.bin).toEqual({ zephyr: "cli" });
  });
});

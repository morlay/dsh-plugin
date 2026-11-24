// 入口推导：`exports` / `bin` / `main` 怎么变成构建入口。判据是「哪些面有产物、哪些面只是源码直连」。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { planOf } from "../compile.ts";

async function makePackage(manifest: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "devkit-plan-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "@local/devkit-plan-fixture", type: "module", ...manifest }, null, 2)}\n`,
  );
  return directory;
}

describe("planOf", () => {
  test("样式与资产出口不打包，其余按出口键建入口", async () => {
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

  test("非 bundle 包的 ./client 是普通 ESM 入口；bundle 包按固定文件推导、不看 exports", async () => {
    const plain = await makePackage({
      exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
    });
    expect((await planOf(plain)).entries["client"]).toBe("./src/client/index.ts");

    // bundle 包的清单里 `exports` 是空对象：入口只能按固定文件取。
    const bundle = await makePackage({ exports: {} });
    await mkdir(join(bundle, "src"), { recursive: true });
    await writeFile(join(bundle, "src", "dsh-bundle.ts"), 'export const name = "x";\n');
    await writeFile(join(bundle, "src", "dsh-bundle.client.ts"), 'export const name = "x";\n');
    const plan = await planOf(bundle);
    expect(plan.entries).toEqual({ index: "./src/dsh-bundle.ts" });
    expect(plan.client).toEqual({ source: "./src/dsh-bundle.client.ts" });
    expect(plan.bundle).toBe(true);
    expect(plan.bundleSource).toBe("./src/dsh-bundle.ts");
  });

  test("bin 目标建隐藏入口（不进出口面）", async () => {
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

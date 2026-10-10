import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserConfig } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineCordisPluginConfig } from "../cordis-host.ts";

// 发布线的两条硬约束：tsdown 顶层不带浏览器替换约定、装饰器按标准（TC39）语义产出。
// 前者踩过一次：`define` 对同一 config 的所有入口生效，host 半的 `process.env.DSH_*` 与
// `import.meta.url` 被替成 `{}.…` / `({}).url`，Electron 壳与另外 8 个包的产物当场失效。
describe("defineCordisPluginConfig", () => {
  let directory: string;
  let config: UserConfig;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "dsh-devkit-plugin-config-"));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "@morlay/devkit-config-fixture", private: true, type: "module" }),
    );
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(join(directory, "src", "index.ts"), "export const fixture = 1;\n");
    const cwd = process.cwd();
    process.chdir(directory);
    try {
      config = await defineCordisPluginConfig();
    } finally {
      process.chdir(cwd);
    }
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("顶层不带浏览器 define（那是 client 半现场打包自己的事）", () => {
    expect(config.define).toBeUndefined();
  });

  it("发布线按标准装饰器语义产出", () => {
    const inputOptions = typeof config.inputOptions === "function" ? undefined : config.inputOptions;
    expect(inputOptions?.transform).toEqual({ decorator: { legacy: false } });
  });
});

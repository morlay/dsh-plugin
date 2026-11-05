import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserConfig } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCordisConfig } from "../cordis-host.ts";

// 发布线的两条硬约束：tsdown 顶层不带浏览器替换约定、装饰器语义不在这里另立一份。
// 前者踩过一次：`define` 对同一 config 的所有入口生效，host 半的 `process.env.DSH_*` 与
// `import.meta.url` 被替成 `{}.…` / `({}).url`，Electron 壳与另外 8 个包的产物当场失效。
// 后者见 `.agents/debts/20260923-装饰器降级散在四个转译点.md`：本仓写端的装饰器返回 legacy 签名，
// 口径只有根 `tsconfig.json` 一处；插件再声明一遍就是第五处。
describe("buildCordisConfig", () => {
  let directory: string;
  let config: UserConfig;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "tsdown-plugin-cordis-config-"));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "@local/tsdown-plugin-cordis-fixture",
        private: true,
        type: "module",
      }),
    );
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(join(directory, "src", "index.ts"), "export const fixture = 1;\n");
    const cwd = process.cwd();
    process.chdir(directory);
    try {
      config = await buildCordisConfig(undefined, {});
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

  it("不覆盖装饰器语义（跟随根 tsconfig 的 legacy，不另立一份）", () => {
    const inputOptions =
      typeof config.inputOptions === "function" ? undefined : config.inputOptions;
    expect(inputOptions?.transform).toBeUndefined();
  });
});

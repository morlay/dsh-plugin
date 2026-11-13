import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { bootstrapApplication, type App } from "@morlay/zephyr";

import { Federation } from "@morlay/zephyr-app/testing";
import { BUNDLER_REV } from "../bundle.ts";
import { FederationDefault } from "@morlay/zephyr-app/testing";
import { FakeAppEnv, FIXTURES, temporaryCache } from "./support/fake-app-env.ts";

// 四条用例只读 `depsUrl` 的解析面（与缓存内容无关）：装配一次，别每条都 bootstrap。
let app: App;
let federation: FederationDefault;

beforeAll(async () => {
  FakeAppEnv.useCache(await temporaryCache());
  app = await bootstrapApplication({ providers: [FakeAppEnv, FederationDefault] });
  federation = app.get(Federation) as FederationDefault;
});

afterAll(async () => {
  await app.dispose();
});

describe("FederationDefault.depsUrl", () => {
  it("裸包名 → `<pkg>@<ver>/index.js`（版本取包清单）", async () => {
    expect(await federation.depsUrl("fixture-row")).toBe(
      `/_zephyr/@modules/fixture-row@2.0.0/index.js?v=${BUNDLER_REV}`,
    );
  });

  it("子路径 → `<pkg>@<ver>/<subpath>.js`（不再拒绝子路径）", async () => {
    expect(await federation.depsUrl("fixture-cjs/jsx-dev-runtime")).toBe(
      `/_zephyr/@modules/fixture-cjs@1.0.0/jsx-dev-runtime.js?v=${BUNDLER_REV}`,
    );
  });

  it("只从**引用方**可见的包也要解析到（exports 里没有 ./package.json也一样）", async () => {
    // 这个包只住在引用方的 node_modules 里（pnpm 严格布局下的传递依赖），且它的 exports 只声明了
    // "./index.js"——按 `<name>/package.json` 去 require 会被 exports 挡住（ERR_PACKAGE_PATH_NOT_EXPORTED），
    // 于是整个包漏成 vite 的文件链（浏览器里出现 /@fs/…/node_modules/.pnpm/…）。
    expect(
      await federation.depsUrl(
        "fixture-nested-exports",
        join(FIXTURES, "packages", "consumer", "src", "index.ts"),
      ),
    ).toBe("/_zephyr/@modules/fixture-nested-exports@4.0.0/index.js?v=" + BUNDLER_REV);
  });

  it("解析不到的包返回 undefined（不编地址）", async () => {
    expect(await federation.depsUrl("no-such-fixture")).toBeUndefined();
  });
  it("CSS 子路径也走联邦地址（brand-font.css）", async () => {
    const url = await federation.depsUrl("@deepseek-ai/dsh-client-ui-theme/brand-font.css");
    expect(url).toBeDefined();
    expect(url).toContain("/brand-font.css");
    expect(url).toMatch(/^\/_zephyr\/@modules\/@deepseek-ai\+dsh-client-ui-theme@/);
  });
});

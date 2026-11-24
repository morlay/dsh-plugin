import { describe, expect, test } from "@morlay/zephyr/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { onTestFinished } from "vitest";
import { join } from "node:path";
import { bootstrapApplication } from "@morlay/zephyr";

import { Federation } from "../federation.contract.ts";
import { BUNDLER_REV } from "../bundle.ts";
import { FederationDefault } from "@morlay/zephyr-dev/testing";
import { AppEnv } from "@morlay/zephyr-app";
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";

/** fixtures 根（`fixture-row` / `fixture-cjs` 等假包住在这里）。 */
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

/**
 * 本用例的临时目录（用完删）。
 * @returns 目录路径。
 */
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-fed-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * 每个用例一份装配（只读 `depsUrl` 的解析面，装配便宜；用完随用例卸）。
 * @returns `Federation` 的实现面。
 */
async function federationOf(): Promise<FederationDefault> {
  // 装配根指仓库里的 fixtures（假包的宿主），数据根与缓存走本用例的临时目录。
  const app = await bootstrapApplication({
    providers: [
      {
        provide: AppEnv,
        useValue: createTestingAppEnv({
          root: await temporaryRoot(),
          profileDir: FIXTURES,
          workingDirectory: FIXTURES,
        }),
      },
      FederationDefault,
    ],
  });
  onTestFinished(() => app.dispose());
  return app.get(Federation) as FederationDefault;
}

describe("FederationDefault.depsUrl", () => {
  test("裸包名 → `<pkg>@<ver>/index.js`（版本取包清单）", async () => {
    const federation = await federationOf();
    expect(await federation.depsUrl("fixture-row")).toBe(
      `/_zephyr/@modules/fixture-row@2.0.0/index.js?v=${BUNDLER_REV}`,
    );
  });

  test("子路径 → `<pkg>@<ver>/<subpath>.js`（不再拒绝子路径）", async () => {
    const federation = await federationOf();
    expect(await federation.depsUrl("fixture-cjs/jsx-dev-runtime")).toBe(
      `/_zephyr/@modules/fixture-cjs@1.0.0/jsx-dev-runtime.js?v=${BUNDLER_REV}`,
    );
  });

  test("只从**引用方**可见的包也要解析到（exports 里没有 ./package.json也一样）", async () => {
    const federation = await federationOf();
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

  test("解析不到的包返回 undefined（不编地址）", async () => {
    const federation = await federationOf();
    expect(await federation.depsUrl("no-such-fixture")).toBeUndefined();
  });
  test("CSS 子路径也走联邦地址（brand-font.css）", async () => {
    const federation = await federationOf();
    const url = await federation.depsUrl("css-fixture/brand-font.css");
    expect(url).toBeDefined();
    expect(url).toContain("/brand-font.css");
    expect(url).toMatch(/^\/_zephyr\/@modules\/css-fixture@1\.0\.0\//);
  });
});

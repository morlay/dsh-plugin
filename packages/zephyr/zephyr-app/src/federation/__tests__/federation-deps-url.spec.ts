import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Context } from "@deepseek-ai/cordis";
import { attachProviders, Injectable, resolveService } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app/testing";
import { ClientRows } from "@morlay/zephyr-app/testing";
import { Federation } from "@morlay/zephyr-app/testing";
import { FederationDefault } from "@morlay/zephyr-app/testing";

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname;

/** fake 环境：`node_modules` 指向 fixtures（里面有 `fixture-row` / `fixture-cjs` 两个假包）。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  private static cache: string | undefined;

  static useCache(cache: string): void {
    FakeAppEnv.cache = cache;
  }

  readonly values: AppEnvValues = {
    profileDir: FIXTURES,
    dataDir: join(tmpdir(), "dsh-federation-test"),
    dev: true,
    aggregate: [],
  };

  readonly cacheDir = FakeAppEnv.cache ?? join(tmpdir(), "dsh-fed-cache");

  readonly packageRoot = PACKAGE_ROOT;

  readonly appBootDir = join(PACKAGE_ROOT, "src", "client", "app-boot");

  readonly profileManifest = join(FIXTURES, "package.json");
}

@Injectable()
class FakeClientRows extends ClientRows {
  readonly rows = ["fixture-row"] as const;

  readonly clientPaths = new Map<string, string>();
}

async function federationOf(cache: string): Promise<FederationDefault> {
  FakeAppEnv.useCache(cache);
  const ctx = new Context();
  await attachProviders(ctx as never, [FakeAppEnv, FakeClientRows, FederationDefault]);
  return resolveService(ctx as never, Federation) as FederationDefault;
}

describe("FederationDefault.depsUrl", () => {
  it("裸包名 → `<pkg>@<ver>/index.js`（版本取包清单）", async () => {
    const federation = await federationOf(await mkdtemp(join(tmpdir(), "dsh-fed-")));
    expect(await federation.depsUrl("fixture-row")).toBe(
      "/_zephyr/@modules/fixture-row@2.0.0/index.js",
    );
  });

  it("子路径 → `<pkg>@<ver>/<subpath>.js`（不再拒绝子路径）", async () => {
    const federation = await federationOf(await mkdtemp(join(tmpdir(), "dsh-fed-")));
    expect(await federation.depsUrl("fixture-cjs/jsx-dev-runtime")).toBe(
      "/_zephyr/@modules/fixture-cjs@1.0.0/jsx-dev-runtime.js",
    );
  });

  it("解析不到的包返回 undefined（不编地址）", async () => {
    const federation = await federationOf(await mkdtemp(join(tmpdir(), "dsh-fed-")));
    expect(await federation.depsUrl("no-such-fixture")).toBeUndefined();
  });
});

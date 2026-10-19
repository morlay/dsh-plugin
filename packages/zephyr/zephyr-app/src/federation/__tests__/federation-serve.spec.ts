import { mkdtemp } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { attachProviders, Injectable, resolveService } from "@morlay/zephyr";
import { beforeAll, describe, expect, it } from "vitest";

import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app/testing";
import { ClientRows } from "@morlay/zephyr-app/testing";
import { Federation } from "@morlay/zephyr-app/testing";
import { FederationDefault } from "@morlay/zephyr-app/testing";

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname;

/** fake 环境：所有路径都指向 fixtures / 临时缓存（不起真服务）。 */
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

/** 最小的 req/res 桩：只记录状态码与 body。 */
function stubResponse(): { res: ServerResponse; status: () => number; body: () => string } {
  let status = 0;
  let body = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string | Buffer) {
      if (typeof chunk === "string") body = chunk;
      else if (chunk !== undefined) body = chunk.toString("utf8");
    },
    headersSent: false,
    writableEnded: false,
    on() {
      return res;
    },
  } as unknown as ServerResponse;
  return { res, status: () => status, body: () => body };
}

const request = { method: "GET", url: "/", headers: {} } as unknown as IncomingMessage;

describe("FederationDefault.serve", () => {
  let federation: FederationDefault;

  beforeAll(async () => {
    const cache = await mkdtemp(join(tmpdir(), "dsh-fed-"));
    FakeAppEnv.useCache(cache);
    const ctx = new Context();
    await attachProviders(ctx as never, [FakeAppEnv, FakeClientRows, FederationDefault]);
    federation = resolveService(ctx as never, Federation) as FederationDefault;
  });

  it("行包命中：产出可读的 JS（含 export）", async () => {
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/fixture-row@2.0.0/client.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body()).toContain("export");
  });

  it("三方 CJS 命中：子路径被转成 ESM（jsxDEV 可见）", async () => {
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/fixture-cjs@1.0.0/jsx-dev-runtime.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body()).toContain("jsxDEV");
  });

  it("未命中：404（不再回空模块）", async () => {
    const { res, status } = stubResponse();
    const handled = await federation.serve("/_zephyr/@modules/nope@1.0.0/index.js", request, res);
    expect(handled).toBe(true);
    expect(status()).toBe(404);
  });
});

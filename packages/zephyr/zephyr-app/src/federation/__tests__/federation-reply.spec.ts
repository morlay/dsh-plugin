import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { attachProviders, Injectable, resolveService } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app/testing";
import { ClientRows } from "@morlay/zephyr-app/testing";
import { Federation } from "@morlay/zephyr-app/testing";
import { FederationDefault } from "@morlay/zephyr-app/testing";

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname;

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
  readonly rows: readonly string[] = [];

  readonly clientPaths = new Map<string, string>();
}

/** 最小 res 桩：记录状态码、content-type 与 body（Buffer 也要接）。 */
function stubResponse(): {
  res: ServerResponse;
  status: () => number;
  headers: () => Record<string, string>;
  body: () => string;
} {
  let status = 0;
  let body = "";
  let headers: Record<string, string> = {};
  const res = {
    writeHead(code: number, h?: Record<string, string>) {
      status = code;
      headers = h ?? {};
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
  return { res, status: () => status, headers: () => headers, body: () => body };
}

const request = { method: "GET", url: "/", headers: {} } as unknown as IncomingMessage;

/** 直接往缓存里摆一份产物 + 清单（模拟 bundlePackage 的输出），验证路由的服务面。 */
async function seedPackage(cache: string, key: string): Promise<void> {
  const dir = join(cache, key);
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "client.js"), "export const ok = 1;\n", "utf8");
  await writeFile(join(dir, "assets", "logo-abc.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(
    join(dir, ".files.json"),
    JSON.stringify({
      rev: "test",
      files: {
        client: `${key}/client.js`,
        "assets/logo-abc.png": `${key}/assets/logo-abc.png`,
      },
    }),
    "utf8",
  );
}

describe("FederationDefault.serve（产物服务面）", () => {
  it("出口产物：200 + JS MIME（构建产物按清单键回给浏览器）", async () => {
    const cache = await mkdtemp(join(tmpdir(), "dsh-fed-reply-"));
    await seedPackage(cache, "fixture-row@2.0.0");
    FakeAppEnv.useCache(cache);
    const ctx = new Context();
    await attachProviders(ctx as never, [FakeAppEnv, FakeClientRows, FederationDefault]);
    const federation = resolveService(ctx as never, Federation) as FederationDefault;

    const { res, status, headers, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/fixture-row@2.0.0/client.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(headers()["content-type"]).toContain("text/javascript");
    // 产物由 `bundlePackage` 实时构建（预置的 `rev` 对不上真实指纹），断言"确实是 fixture 的 JS 产物"即可。
    expect(body()).toContain("fixture-row");
  });

  it("资产：按扩展名给 MIME 且长缓存", async () => {
    const cache = await mkdtemp(join(tmpdir(), "dsh-fed-asset-"));
    await seedPackage(cache, "fixture-row@2.0.0");
    FakeAppEnv.useCache(cache);
    const ctx = new Context();
    await attachProviders(ctx as never, [FakeAppEnv, FakeClientRows, FederationDefault]);
    const federation = resolveService(ctx as never, Federation) as FederationDefault;

    const { res, status, headers } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/fixture-row@2.0.0/assets/logo-abc.png",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(headers()["content-type"]).toBe("image/png");
    expect(headers()["cache-control"]).toContain("immutable");
  });
});

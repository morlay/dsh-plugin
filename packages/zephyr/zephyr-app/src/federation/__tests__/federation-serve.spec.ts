import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Federation } from "@morlay/zephyr-app/testing";
import { FederationDefault } from "@morlay/zephyr-app/testing";
import { FakeAppEnv, temporaryCache } from "./support/fake-app-env.ts";

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

/** 直接往缓存里摆一份产物 + 清单（模拟 `bundlePackage` 的输出），验证路由的服务面。 */
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

/** 一套装配 / 一份缓存跑四条（路由服务面与产物形态同源）。 */
let app: App;
let federation: FederationDefault;
let cache: string;

beforeAll(async () => {
  cache = await temporaryCache();
  FakeAppEnv.useCache(cache);
  app = await bootstrapApplication({ providers: [FakeAppEnv, FederationDefault] });
  federation = app.get(Federation) as FederationDefault;
});

afterAll(async () => {
  await app.dispose();
});

describe("FederationDefault.serve", () => {
  it("行包命中：200 + JS MIME + 可读的 JS（构建产物按清单键回给浏览器）", async () => {
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

  it("资产：按扩展名给 MIME 且长缓存", async () => {
    // 摆在最后：这一步只按清单服务文件、不触发构建，但会覆盖同一 key 的 `.files.json`。
    await seedPackage(cache, "fixture-row@2.0.0");
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

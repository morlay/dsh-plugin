import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUNDLER_REV } from "@morlay/zephyr-dev/testing";

import { Federation } from "../federation.contract.ts";
import { FederationDefault } from "@morlay/zephyr-dev/testing";
import { FakeAppEnv, FIXTURES, temporaryCache } from "./support/fake-app-env.ts";

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
  // 命名空间：联邦产物一律落在 `<cacheDir>/client-modules` 下（见 `AppEnv.cacheDirOf`）。
  const dir = join(cache, "client-modules", key);
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

  it("包根解析不到：带上下文的错（不是静默 404）", async () => {
    // 404 说的是「文件不存在」，而这里是「构建期写了一条地址、运行期没有基准能解释它」：
    // 正文要点名地址与解析基准，否则排查的人会去翻产物目录。
    const { res, status, body } = stubResponse();
    const handled = await federation.serve("/_zephyr/@modules/ghost-pkg@1.0.0/index.js", request, res);
    expect(handled).toBe(true);
    expect(status()).toBe(500);
    expect(body()).toContain("federation-miss:");
    expect(body()).toContain("ghost-pkg@1.0.0/index.js");
    expect(body()).toContain("解析不到包根");
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
  it("CJS 子路径：shim/with-selector 的具名导出可见（cjsShimOf 在真实路径生效）", async () => {
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/usync-fixture@1.0.0/shim/with-selector.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body()).toContain("useSyncExternalStoreWithSelector");
  });
  it("CSS 子路径出口：brand-font.css 走联邦地址可服务（不是 404）", async () => {
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/css-fixture@1.0.0/brand-font.css",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body()).toContain("--brand-font");
  });
  it("出口名与某个包同名时按 exports 解析：拿到的是那份语法，不是同名包的字节", async () => {
    // 现场：`@shikijs/langs` 的出口名 `typescript` 与 npm 包 `typescript` 同名。按**包名**解析会拿到
    // 整份 TS 编译器（默认导出是它的 `module.exports`，没有 `scopeName`），shiki 在构造 Registry 时炸
    // `Cannot read properties of undefined (reading 'split')`；出口 → 入口只能按 `exports` 解析。
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/langs-fixture@1.0.0/typescript.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body(), "是那份语法模块").toContain("source.ts");
    expect(body(), "不是同名包的字节").not.toContain("TYPESCRIPT-COMPILER");
  });

  it("缓存命中也重放包根表：运行期按名拼的出口现场构建，不是 404", async () => {
    // 现场：`@shikijs/langs/toml` 只出现在**运行期拼出来的地址**里（源码面没有静态 import），
    // 而那个包在 pnpm 严格布局下不在应用自己的 node_modules 里——本会话没构建过它时，
    // 包根表只能从上一轮产物清单（`.files.json` 的 `resolved`）里重放出来。
    const root = join(FIXTURES, "packages", "consumer", "node_modules", "runtime-langs-fixture");
    const dir = join(cache, "client-modules", "fixture-consumer@1.0.0");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.js"), "export const ok = 1;\n", "utf8");
    await writeFile(
      join(dir, ".files.json"),
      JSON.stringify({
        // 规则世代对得上（只有它可比：包根未知时 `expectedRev` 是 undefined）。
        rev: `${BUNDLER_REV}:fixture`,
        files: { index: "fixture-consumer@1.0.0/index.js" },
        resolved: [["runtime-langs-fixture", "1.0.0", root]],
      }),
      "utf8",
    );
    // 先命中一次缓存（这一步应当把 `resolved` 重放进包根表）。
    const warm = stubResponse();
    await federation.serve("/_zephyr/@modules/fixture-consumer@1.0.0/index.js", request, warm.res);
    expect(warm.status()).toBe(200);
    // 再取那个「运行期按名」的出口：必须现场构建出来。
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/runtime-langs-fixture@1.0.0/toml.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status(), "不是 404（unresolved entry）").toBe(200);
    expect(body()).toContain("source.toml");
  });

  it("冷请求：按 Node 的解析规则从应用根找到包根（普通 node_modules 布局）", async () => {
    // 现场：`@shikijs/langs/toml.js` 这种「运行期按名拼」的地址，冷请求（本会话没建过任何产物）
    // 没有引用方、也没有上一轮清单的 `resolved`——唯一能用的解析基准是应用清单，且只走 Node 的
    // 解析（不猜包管理器布局）。这条不预热、直接取，判的是 cold 就是 200。
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/runtime-langs@1.0.0/toml.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status(), "冷请求不是 404（unresolved entry）").toBe(200);
    expect(body()).toContain("source.toml");
  });

  it("无 exports 的包子路径：shim/with-selector 落到文件而不是主入口", async () => {
    const { res, status, body } = stubResponse();
    const handled = await federation.serve(
      "/_zephyr/@modules/usync-plain-fixture@1.7.0/shim/with-selector.js",
      request,
      res,
    );
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body()).toContain("useSyncExternalStoreWithSelector");
    expect(body()).not.toContain("main entry point is not supported");
  });
});
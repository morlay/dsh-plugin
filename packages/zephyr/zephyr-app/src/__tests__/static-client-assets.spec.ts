// 生产态的静态投递（判据 3）：**目录里有什么就投什么**，不认构建、不认缓存失效。
//
// 四条：① 投得出来且 content-type 对；② 不存在的路径 404；③ `?v=` 被忽略；
// ④ `hmr` 恒 false、`onServerSourceChange` 返回的函数可调。
//
// 另外遍历反查：目录里**每个文件**都能用同一套地址规则取到（URL ↔ 磁盘路径一一对应）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { StaticClientAssets } from "../client-assets/static-client-assets.service.ts";

/** 本轮建的临时目录（用例结束统一删）。 */

/** 一次应答的结果。 */
interface Reply {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: string;
}

/**
 * 造一个静态目录：`index.html` + 一个包的 `client.js` + 一份 `.files.json`。
 * @returns 目录的绝对路径。
 */
async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zephyr-static-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.html"), '<!doctype html><div id="root"></div>\n', "utf8");
  await mkdir(join(dir, "demo@1.2.3"), { recursive: true });
  await writeFile(join(dir, "demo@1.2.3", "client.js"), "export const ok = 1;\n", "utf8");
  await writeFile(join(dir, "demo@1.2.3", ".files.json"), "{}\n", "utf8");
  return dir;
}

/**
 * 直接调 `serve`（不经 http server：它自己写 `res`）。
 * @param assets - 被静的投递实现。
 * @param url - 请求路径（含 query）。
 * @returns 状态、content-type 与正文。
 */
async function serve(assets: StaticClientAssets, url: string): Promise<Reply | undefined> {
  const chunks: Buffer[] = [];
  let status = 0;
  let headers: Record<string, unknown> = {};
  const res = {
    writeHead(code: number, values: Record<string, unknown> = {}): unknown {
      status = code;
      headers = values;
      return res;
    },
    end(chunk?: unknown): unknown {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk as Uint8Array));
      return res;
    },
  } as unknown as ServerResponse;
  const handled = await assets.serve({ url, method: "GET" } as IncomingMessage, res);
  if (!handled) return undefined;
  return {
    status,
    contentType: headers["content-type"] as string | undefined,
    body: Buffer.concat(chunks).toString("utf8"),
  };
}

describe("StaticClientAssets（prod 的 ClientAssets）", () => {
  test("按地址投文件：client.js 与 index.html 都 200，content-type 对", async () => {
    const dir = await fixtureDir();
    const assets = new StaticClientAssets({ dir });
    const js = await serve(assets, "/_zephyr/@modules/demo@1.2.3/client.js");
    expect(js?.status).toBe(200);
    expect(js?.contentType).toBe("text/javascript; charset=utf-8");
    expect(js?.body).toContain("export const ok = 1");
    const page = await serve(assets, "/");
    expect(page?.status).toBe(200);
    expect(page?.contentType).toBe("text/html; charset=utf-8");
    expect(page?.body).toContain('<div id="root">');
  });

  test("不存在的路径不投（404 由调用方出：它返回 false）", async () => {
    const assets = new StaticClientAssets({ dir: await fixtureDir() });
    await expect(serve(assets, "/_zephyr/@modules/demo@1.2.3/missing.js")).resolves.toBeUndefined();
    await expect(serve(assets, "/nope.js")).resolves.toBeUndefined();
  });

  test("?v= 被忽略：带与不带是同一个文件", async () => {
    const assets = new StaticClientAssets({ dir: await fixtureDir() });
    const plain = await serve(assets, "/_zephyr/@modules/demo@1.2.3/client.js");
    const versioned = await serve(assets, "/_zephyr/@modules/demo@1.2.3/client.js?v=abcd1234");
    expect(versioned).toEqual(plain);
  });

  test("hmr 恒 false，onServerSourceChange 返回可调用的撤销函数", () => {
    const assets = new StaticClientAssets({ dir: "/tmp/never-read" });
    expect(assets.hmr).toBe(false);
    const undo = assets.onServerSourceChange(() => {});
    expect(typeof undo).toBe("function");
    expect(() => undo()).not.toThrow();
  });

  test("URL ↔ 磁盘路径一一对应：目录里每个文件都能按同一套规则取到", async () => {
    const dir = await fixtureDir();
    const assets = new StaticClientAssets({ dir });
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(dir, { withFileTypes: true, recursive: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const url = file === "index.html" ? "/" : `/_zephyr/@modules/${file}`;
      const reply = await serve(assets, url);
      expect(reply?.status, file).toBe(200);
    }
  });

  test("穿出目录的地址一律不认（../ 不许读静态目录之外的东西）", async () => {
    const assets = new StaticClientAssets({ dir: await fixtureDir() });
    await expect(serve(assets, "/_zephyr/@modules/../../package.json")).resolves.toBeUndefined();
  });
});

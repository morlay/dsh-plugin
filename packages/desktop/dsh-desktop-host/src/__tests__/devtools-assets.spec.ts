import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { installDevtoolsAssets } from "../devtools-assets.ts";
import { DEVTOOLS_ASSETS_PREFIX } from "../paths.ts";
import { PortlessWebServer } from "../webserver.ts";

const ASSETS = join(
  "node_modules",
  "@deepseek-ai",
  "dsh-experimental-inspector",
  "lib",
  "devtools",
);

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-devtools-"));
  const dir = join(root, ASSETS);
  await mkdir(join(dir, "entrypoints", "devtools_app"), { recursive: true });
  await writeFile(join(dir, "devtools_app.html"), "<title>DevTools</title>", "utf8");
  await writeFile(
    join(dir, "entrypoints", "devtools_app", "devtools_app.js"),
    "export {};",
    "utf8",
  );
  await writeFile(join(root, "secret.txt"), "secret", "utf8");
  return root;
}

function serve(root: string): PortlessWebServer {
  const ctx = new Context();
  const webServer = new PortlessWebServer(ctx, {});
  installDevtoolsAssets(ctx, [join(root, "missing"), root]);
  return webServer;
}

function get(path: string): Request {
  return new Request(new URL(path, "http://app.invalid"));
}

describe("调试窗口的前端产物托管", () => {
  it("命中任一装了产物的根，按相对路径取文件", async () => {
    const root = await fixture();
    const webServer = serve(root);

    const entry = await webServer.dispatch(get(`${DEVTOOLS_ASSETS_PREFIX}/devtools_app.html`));
    expect(entry.status).toBe(200);
    expect(entry.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(entry.text()).resolves.toBe("<title>DevTools</title>");

    const chunk = await webServer.dispatch(
      get(`${DEVTOOLS_ASSETS_PREFIX}/entrypoints/devtools_app/devtools_app.js`),
    );
    expect(chunk.status).toBe(200);
    expect(chunk.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("产物不在闭包里时回 404，而不是抛错", async () => {
    const webServer = serve(await mkdtemp(join(tmpdir(), "dsh-devtools-empty-")));
    expect(
      (await webServer.dispatch(get(`${DEVTOOLS_ASSETS_PREFIX}/devtools_app.html`))).status,
    ).toBe(404);
  });

  it("越出产物目录的路径与非 GET 一律拒绝", async () => {
    const webServer = serve(await fixture());
    const escape = await webServer.dispatch(
      get(`${DEVTOOLS_ASSETS_PREFIX}/%2e%2e%2f%2e%2e%2fsecret.txt`),
    );
    expect(escape.status).toBe(404);
    const missing = await webServer.dispatch(get(`${DEVTOOLS_ASSETS_PREFIX}/nope.js`));
    expect(missing.status).toBe(404);
    const posted = await webServer.dispatch(
      new Request(new URL(`${DEVTOOLS_ASSETS_PREFIX}/devtools_app.html`, "http://app.invalid"), {
        method: "POST",
      }),
    );
    expect(posted.status).toBe(405);
  });
});

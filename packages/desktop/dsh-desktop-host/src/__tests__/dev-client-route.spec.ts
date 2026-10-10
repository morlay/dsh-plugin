import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { apply, type Config } from "../dev-client/index.ts";

const DEV_PACKAGE = "@morlay/dsh-client-ui-fixture";
const OFFICIAL_PACKAGE = "@deepseek-ai/dsh-client-ui-fixture";
const OFFICIAL_BYTES =
  'window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-ui-fixture" });\n';
const DEV_SOURCE = [
  "export const inject: readonly string[] = [];",
  "export function apply(): void {}",
  "",
].join("\n");

// 行 fixture：返回的 client 出口路径就是判据的输入。`source` 给出时出口指源码（`.ts`，源码面行的形态）；
// `built: true` 让出口指产物（`.js`），用来验「显式点名压过产物行」这条路。
async function fixturePackage(
  name: string,
  options: { source?: string; built?: boolean } = {},
): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "dev-client-bundles-")), "pkg");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name })}\n`);
  await writeFile(join(root, "dist", "client.js"), OFFICIAL_BYTES);
  if (options.source !== undefined) {
    await mkdir(join(root, "src", "client"), { recursive: true });
    await writeFile(join(root, "src", "client", "index.ts"), options.source);
  }
  if (options.built === true || options.source === undefined)
    return join(root, "dist", "client.js");
  return join(root, "src", "client", "index.ts");
}

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface Harness {
  serve: (req: IncomingMessage) => Promise<Captured>;
  fallbackRequests: string[];
  errors: unknown[];
}

function harness(config: Config, paths: Record<string, string>): Harness {
  const routes: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => unknown;
  }[] = [];
  const fallbackRequests: string[] = [];
  const errors: unknown[] = [];
  const webServer = {
    register: (route: (typeof routes)[number]) => {
      routes.push(route);
      return () => {};
    },
  };
  const clientModules = {
    graph: () => ({
      rev: "rev",
      entries: Object.keys(paths).map((id) => ({ id, url: "", rev: "" })),
      batches: [],
    }),
    clientPath: (id: string): string | undefined => paths[id],
    fetchBundle: (request: Request): Response => {
      fallbackRequests.push(request.url);
      return new Response(OFFICIAL_BYTES, {
        status: 200,
        headers: { "content-type": "text/javascript" },
      });
    },
  };
  const ctx = {
    logger: { error: (error: unknown) => errors.push(error) },
    webServer,
    clientModules,
    get: (name: string): unknown => (name === "webServer" ? webServer : clientModules),
    effect: (callback: () => unknown) => {
      callback();
    },
  } as unknown as Context;

  apply(ctx, config);
  const route = routes[0];
  if (route === undefined) throw new Error("route was not registered");
  expect(route.path).toBe("/plugins/");

  return {
    fallbackRequests,
    errors,
    serve: async (req: IncomingMessage): Promise<Captured> => {
      const captured: Captured = { status: 0, headers: {}, body: "" };
      const res = {
        writeHead: (status: number, headers?: Record<string, string>) => {
          captured.status = status;
          captured.headers = headers ?? {};
          return res;
        },
        end: (body?: string | Uint8Array) => {
          captured.body =
            body === undefined
              ? ""
              : typeof body === "string"
                ? body
                : Buffer.from(body).toString("utf8");
          return res;
        },
      } as unknown as ServerResponse;
      await route.handler(req, res);
      return captured;
    },
  };
}

function request(url: string, method = "GET"): IncomingMessage {
  return { method, url } as unknown as IncomingMessage;
}

describe("dev client bundles route", () => {
  it("bundles a source-exporting row and keeps built rows as built bytes", async () => {
    const paths = {
      [DEV_PACKAGE]: await fixturePackage(DEV_PACKAGE, { source: DEV_SOURCE }),
      [OFFICIAL_PACKAGE]: await fixturePackage(OFFICIAL_PACKAGE),
    };
    const { serve, fallbackRequests } = harness({}, paths);
    const response = await serve(
      request(`/plugins/??${DEV_PACKAGE}/client.js,${OFFICIAL_PACKAGE}/client.js&rev=abc`),
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain(`window.__ModuleLoader__.load({\n\tid: "${DEV_PACKAGE}"`);
    expect(response.body).toContain("exports.apply = apply;");
    expect(response.body).toContain(OFFICIAL_BYTES.trim());
    expect(response.body).not.toContain("sourceMappingURL");
    expect(fallbackRequests).toEqual([]);
  });

  it("lets an explicit package list override a row whose client export is built", async () => {
    const paths = {
      [DEV_PACKAGE]: await fixturePackage(DEV_PACKAGE, { source: DEV_SOURCE }),
      [OFFICIAL_PACKAGE]: await fixturePackage(OFFICIAL_PACKAGE, { source: DEV_SOURCE, built: true }),
    };
    const { serve } = harness({ packages: [DEV_PACKAGE] }, paths);
    const response = await serve(request(`/plugins/??${OFFICIAL_PACKAGE}/client.js&rev=abc`));
    expect(response.body).toBe(OFFICIAL_BYTES);
  });

  it("hands bundles that declare no local package back to the module table", async () => {
    const paths = { [OFFICIAL_PACKAGE]: await fixturePackage(OFFICIAL_PACKAGE) };
    const { serve, fallbackRequests } = harness({}, paths);
    const response = await serve(request(`/plugins/??${OFFICIAL_PACKAGE}/client.js&rev=abc`));
    expect(response.status).toBe(200);
    expect(response.body).toBe(OFFICIAL_BYTES);
    expect(fallbackRequests).toEqual([
      `http://dsh.invalid/plugins/??${OFFICIAL_PACKAGE}/client.js&rev=abc`,
    ]);
  });

  it("hands source-map and non-GET requests back to the module table", async () => {
    const paths = { [DEV_PACKAGE]: await fixturePackage(DEV_PACKAGE, { source: DEV_SOURCE }) };
    const { serve, fallbackRequests } = harness({}, paths);
    await serve(request(`/plugins/??${DEV_PACKAGE}/client.js.map&rev=abc`));
    await serve(request(`/plugins/??${DEV_PACKAGE}/client.js&rev=abc`, "POST"));
    expect(fallbackRequests).toHaveLength(2);
  });

  it("reports a configured package whose client row or source entry is missing", async () => {
    const paths = { [DEV_PACKAGE]: await fixturePackage(DEV_PACKAGE) };
    const { serve, errors } = harness({ packages: [DEV_PACKAGE] }, paths);
    const noSource = await serve(request(`/plugins/??${DEV_PACKAGE}/client.js&rev=abc`));
    expect(noSource.status).toBe(500);
    expect(noSource.body).toContain("has no client source at");

    const other = harness({ packages: ["@morlay/missing"] }, paths);
    const noRow = await other.serve(request("/plugins/??@morlay/missing/client.js&rev=abc"));
    expect(noRow.status).toBe(500);
    expect(noRow.body).toContain("@morlay/missing is not a client module row");
    expect(errors).toHaveLength(1);
  });
});

// `/api` 的 **HTTP 面全流程**：真宿主、真 `fetch`、真准入围栏。
//
// 一条 unary 在浏览器里要穿过三层才落地：HTTP 前缀（准入 + 桥）→ 上游共享分派器 → `/api` 通道上
// 按注册顺序问拦截项。任一层装错，界面看到的是「点了没反应」或「编辑没生效」这类离原因很远的文案，
// 所以判据走真请求：自研端点与上游贡献方的端点在同一宿主上都得调通。
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteHandlers } from "../../api-gateway/remote-handlers.contract.ts";
import { mountWireApp, type WireApp } from "../../__tests__/support/wire-app.ts";

const opened: WireApp[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose();
}, 30_000);

/** 起一份真宿主并在用例后拆掉。 */
async function boot(): Promise<WireApp> {
  const app = await mountWireApp();
  opened.push(app);
  return app;
}

/** 上游 `connection` 实例上的 `rpc.intercept`（共享通道的贡献方就是从这里注册的）。 */
interface RpcContributor {
  rpc: {
    intercept(
      channel: "/api",
      matches: (endpoint: string) => boolean,
      handler: (
        endpoint: string,
        payload: unknown,
        signal: AbortSignal,
        peer: unknown,
      ) => Promise<unknown>,
    ): () => Promise<void>;
  };
}

/**
 * 上游实例：按名字读（装配期才有、且要的是那个实例本身，例外见写作规范）。
 * @param app - 真宿主。
 * @returns 上游 `connection` 的 rpc 面。
 */
function rpcOf(app: WireApp): RpcContributor["rpc"] {
  const instance = app.app.ctx.get("connection", false) as RpcContributor | undefined;
  if (instance?.rpc === undefined) throw new Error("宿主没有上游 connection 实例");
  return instance.rpc;
}

describe("/api 的 HTTP 面（真宿主 + 真 fetch）", { timeout: 20_000 }, () => {
  it("自研端点：客户端一次 unary 落到路由表，命名参数原样过去、结果原样回来", async () => {
    const host = await boot();
    const seen: Readonly<Record<string, unknown>>[] = [];
    host.app.get(RemoteHandlers).register("settings/describe", async (args) => {
      seen.push(args);
      return { items: [{ key: "ui.theme" }] };
    });

    await expect(
      host.client().invoke("settings/describe", { args: { scope: "ui" } }),
    ).resolves.toEqual({ items: [{ key: "ui.theme" }] });
    expect(seen, "命名参数要原样进处理器").toEqual([{ scope: "ui" }]);
  });

  it("处理器抛错：客户端拿到带 code / details 的失败，而不是一个 404", async () => {
    const host = await boot();
    host.app.get(RemoteHandlers).register("settings/write", async () => {
      throw Object.assign(new Error("设置项只读"), {
        code: "settings/read-only",
        details: { key: "ui.theme" },
      });
    });

    await expect(host.client().invoke("settings/write", { args: {} })).rejects.toMatchObject({
      code: "settings/read-only",
      message: "设置项只读",
      details: { key: "ui.theme" },
    });
  });

  it("上游贡献方与自研组共存：各自认领的端点都调通（共享通道一条只容一个物理拦截器）", async () => {
    const host = await boot();
    host.app.get(RemoteHandlers).register("settings/describe", async () => ({ from: "自研" }));
    // 上游风格的一个贡献方：直接往 `/api` 通道注册（上游的 api-gateway 就是这么做的）。
    rpcOf(host).intercept(
      "/api",
      (endpoint) => endpoint === "upstream/echo",
      async (_endpoint, payload) => ({ ok: true, value: { from: "上游", payload } }),
    );

    const client = host.client();
    await expect(client.invoke("settings/describe", { args: {} })).resolves.toEqual({
      from: "自研",
    });
    await expect(client.invoke("upstream/echo", { args: { n: 1 } })).resolves.toEqual({
      from: "上游",
      payload: { args: { n: 1 } },
    });
  });

  it("没人认领的端点：客户端拿到传输失败，不会挂住", async () => {
    const host = await boot();
    await expect(host.client().invoke("nobody/serves", { args: {} })).rejects.toThrow(
      /transport failure/u,
    );
  });

  it("准入：本机的 unary 放行，跨站标记的请求挡在 403", async () => {
    const host = await boot();
    host.app.get(RemoteHandlers).register("settings/describe", async () => ({ ok: true }));
    const body = JSON.stringify({
      type: "client-request",
      rpcId: "r1",
      method: "settings/describe",
      payload: { args: {} },
    });

    await expect(postJson(host, body, {})).resolves.toBe(200);
    // 跨站标记是浏览器自己填的：别的站点借道本机端口时一定带上它。
    await expect(postJson(host, body, { "sec-fetch-site": "cross-site" })).resolves.toBe(403);
  });
});

/**
 * 往 `/api/settings/describe` 发一条 unary（node 原生请求：`fetch` 会丢掉 `sec-fetch-site` 这类头）。
 * @param host - 真宿主。
 * @param body - 请求体。
 * @param headers - 额外的请求头。
 * @returns 响应状态码。
 */
async function postJson(
  host: WireApp,
  body: string,
  headers: Readonly<Record<string, string>>,
): Promise<number> {
  const url = new URL("/api/settings/describe", host.origin);
  return await new Promise<number>((resolve, reject) => {
    const pending = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolve(response.statusCode ?? 0);
        });
      },
    );
    pending.on("error", reject);
    pending.end(body);
  });
}

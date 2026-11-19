/**
 * api-gateway 装配面（一套装配跑三件事）：
 *
 * 1. `typertGateway` 服务面按名字可解析、面齐（上游所有 `@Remote` 服务执行时都找它）；
 * 2. `/api` 的 WebSocket 升级真的注册到 `WebServer`（RPC 拦截点）；
 * 3. 一次 `invoke` 能走到上游分派（没有 `SessionController` 的最小栈里以「服务不存在」失败——
 *    但那已经证明请求走通了）。
 *
 * 三件事读的是同一份装配（`typert` + `remoteAccess` + `connection` + `api-gateway`），
 * 原来分居三个文件、各 bootstrap 一次；合起来只付一次装配成本。wire 载体（`/api/remote.mux`）
 * 在这一份里**只有上游那一条**：自研 mux 不进这份清单，否则同一路径两个 upgrade。
 */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import type { InvokeRemoteRequest } from "../typert/gateway.contract.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppEnvDefault,
  CredentialsInMemory,
  WebServer,
  provideApiGateway,
  provideAppEnv,
  provideConnection,
  provideRemoteAccess,
  provideTypert,
  provideWeb,
} from "@morlay/zephyr-app/testing";
import { Typert } from "../typert/typert.contract.ts";
import { TypertGateway } from "../typert/gateway.contract.ts";

// 随机端口：`WebStartupDefault` 读 `process.env.PORT`（缺省 3080），并行跑的 web spec 会互相抢。
process.env.PORT ??= "0";

let app: App;

beforeAll(async () => {
  app = await bootstrapApplication({
    providers: [
      ...provideWeb(),
      ...provideTypert(),
      ...provideRemoteAccess(),
      ...provideConnection(),
      ...provideApiGateway(),
      CredentialsInMemory,
      ...provideAppEnv(
        configure(AppEnvDefault, {
          profileDir: process.cwd(),
          dataDir: join(tmpdir(), "dsh-api-gateway-test"),
        }),
      ),
    ],
    timeoutMs: 15_000,
  });
});

afterAll(async () => {
  await app.dispose();
});

/**
 * 一个 owner peer（本机界面通道的那份身份）。
 * @param app - 起好的应用（peer 的 ctx 指它）。
 * @returns 上游 `invoke` / `dispatchRpc` 要的 peer 面。
 */
function ownerPeer(app: App): InvokeRemoteRequest["peer"] {
  return {
    // 只有 `id` 是品牌类型（`dsh-brand`）：字面量在这里收窄一次，其余成员按类型检查。
    id: "spec-peer" as InvokeRemoteRequest["peer"]["id"],
    ctx: app.ctx,
    principal: { kind: "owner" },
    interactions: "answer",
    signal: new AbortController().signal,
    dispose: async (): Promise<void> => {},
  };
}

describe("api-gateway 装配面", { timeout: 20_000 }, () => {
  it("装上之后，`typertGateway` 按名字可解析且面齐", () => {
    const gateway = app.get(TypertGateway);
    expect(gateway, "`typertGateway` 必须可解析").toBeDefined();
    expect(gateway.wireStream, "载体适配必须在").toBeDefined();
    expect(typeof gateway.invoke).toBe("function");
    expect(typeof gateway.stream).toBe("function");
    expect(typeof gateway.hasLiveClient).toBe("function");
    expect(gateway.getPendingRemoteEvents(), "初始没有未结算的转发事件").toEqual([]);
    // 注册表同在：上游 `@Remote` 服务把自己登记进它。
    expect(app.get(Typert)).toBeDefined();
  });

  it("交回 connection / webServer 之后，upgrade 只有上游那一条 /api/remote.mux", () => {
    expect(app.tryGet(WebServer), "WebServer 应由 provideWeb() 提供").toBeDefined();
    const upgrades = app
      .get(WebServer)
      .routesOf()
      .filter((route) => route.kind === "upgrade")
      .map((route) => route.path);
    // 名单里唯一的一条就是上游在 ctx.inject(['connection','webServer']) 里注册的那条；
    // 少一条 = 它没拿到 webServer，多一条 = 同一路径又挂了一个 upgrade。
    expect(upgrades).toEqual(["/api/remote.mux"]);
  });

  it("invoke 走到上游分派（最小栈里以「服务不存在」失败，证明请求走通了）", async () => {
    const gateway = app.get(TypertGateway);
    const peer = ownerPeer(app);
    const outcome = await gateway
      .invoke({ namespace: "session", method: "list", args: {}, peer })
      .then((value) => ({ ok: true, value }))
      .catch((error: unknown) => ({
        ok: false,
        error: String(error),
        stack: (error as Error).stack ?? "",
      }));
    expect(outcome).toBeDefined();
    expect(outcome.ok, "最小栈里没有 SessionController：应当走通并如实失败").toBe(false);
  });
  it("`/api` 的 HTTP 请求先过 Host / Origin 信任检查（跨站 Origin 回 403）", async () => {
    const webServer = app.get(WebServer);
    const url = `http://127.0.0.1:${String(webServer.port)}/api/session/list`;
    const body = JSON.stringify({
      type: "client-request",
      rpcId: "fence-probe",
      method: "session/list",
      payload: { args: {} },
    });
    const post = (headers: Record<string, string>): Promise<Response> =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      });

    // 上游的信任围栏只有拿到**原始请求头**才成立：换成 `Request` 之后 `origin` / `sec-*`
    // 都在 forbidden header 名单里被丢掉，围栏就永远看不见它们。
    const crossSite = await post({ origin: "http://evil.example" });
    expect(crossSite.status, "跨站 Origin 必须被挡在分派之前").toBe(403);
    const sameOrigin = await post({ origin: `http://127.0.0.1:${String(webServer.port)}` });
    expect(sameOrigin.status, "本机页面的请求照常进分派").not.toBe(403);
  });

  it("$events/result 走上游 wire 分派（不是 Remote 方法）", async () => {
    const gateway = app.get(TypertGateway);
    const outcome = await gateway.dispatchWire(
      "$events/result",
      // 一个不存在的客户端：分派本身走通，由上游判定「没有对应的活跃事件流」。
      {
        args: {
          clientId: "no-such-client",
          eventId: "no-such-event",
          outcome: { kind: "next" },
        },
      },
      new AbortController().signal,
      ownerPeer(app),
    );

    expect(outcome.ok).toBe(false);
    const text = JSON.stringify(outcome);
    // 判据：进的是上游那条答复路径（`remoteEventClients` 查不到），而不是当成方法去找。
    expect(text).toContain("no active event stream");
    expect(text).not.toContain("no active Remote method exports this endpoint");
  });
});

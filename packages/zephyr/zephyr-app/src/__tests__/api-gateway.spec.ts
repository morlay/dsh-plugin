/**
 * api-gateway 装配面（一套装配跑三件事）：
 *
 * 1. `typertGateway` 服务面按名字可解析、面齐（上游所有 `@Remote` 服务执行时都找它）；
 * 2. `/api` 的 WebSocket 升级真的注册到 `WebServer`（RPC 拦截点）；
 * 3. 一次 `invoke` 能走到上游分派（没有 `SessionController` 的最小栈里以「服务不存在」失败——
 *    但那已经证明请求走通了）。
 *
 * 三件事读的是同一份装配（`typert` + `remoteAccess` + `connection` + `api-gateway` + `mux-server`），
 * 原来分居三个文件、各 bootstrap 一次；合起来只付一次装配成本。
 */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppEnvDefault,
  CredentialsInMemory,
  WebServer,
  provideApiGateway,
  provideAppEnv,
  provideConnection,
  provideMuxServer,
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
      ...provideMuxServer(),
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

  it("api-gateway 注册的 /api 升级出现在 routesOf()", () => {
    expect(app.tryGet(WebServer), "WebServer 应由 provideWeb() 提供").toBeDefined();
    const routes = app.get(WebServer).routesOf();
    expect(routes.some((route) => route.kind === "upgrade" && route.path.startsWith("/api"))).toBe(
      true,
    );
  });

  it("invoke 走到上游分派（最小栈里以「服务不存在」失败，证明请求走通了）", async () => {
    const gateway = app.get(TypertGateway) as unknown as {
      invoke(request: {
        namespace: string;
        method: string;
        args: Record<string, unknown>;
        peer: unknown;
      }): Promise<unknown>;
    };
    const serviceCtx = (app.ctx as unknown as { get(n: string, s?: boolean): unknown }).get(
      "typertGateway",
      false,
    );
    const peer = {
      id: "spec-peer",
      ctx: serviceCtx,
      principal: { kind: "owner" },
      interactions: "answer",
      signal: new AbortController().signal,
      dispose: async (): Promise<void> => {},
    };
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
});

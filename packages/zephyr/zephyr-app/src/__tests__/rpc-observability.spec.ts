/**
 * RPC 拦截点：`api-gateway` 的行注册 `/api` 后，`/api` 的 WebSocket 升级要出现在 `WebServer.routesOf()`。
 *
 * 断言走契约面（路由表），不依赖日志捕获——打印由 `WebRuntimeService` 读同一份表输出，另有单测。
 */
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { CredentialsDefault } from "@morlay/dsh-auth";
import { describe, expect, it } from "vitest";
import { ApiGatewayModule, ConnectionModule, RemoteAccessModule, TypertModule } from "@morlay/zephyr-app";
import { WebServer, WebServerDefault, WebStartup } from "@morlay/zephyr-app";
import { TestAppEnv } from "./support/row-fakes.ts";

@Injectable()
class Startup0 extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

describe("RPC 拦截点（真 api-gateway 行）", { timeout: 20_000 }, () => {
  it("api-gateway 注册的 /api 升级出现在 routesOf()", async () => {
    const app = await bootstrapApplication({
      imports: [TypertModule, RemoteAccessModule, ConnectionModule, ApiGatewayModule],
      providers: [Startup0, TestAppEnv, CredentialsDefault, WebServerDefault],
      timeoutMs: 15_000,
    });
    try {
      const routes = app.get(WebServer).routesOf();
      expect(routes.some((route) => route.kind === "upgrade" && route.path.startsWith("/api"))).toBe(
        true,
      );
    } finally {
      await app.dispose();
    }
  });
});

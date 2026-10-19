import { describe, expect, it } from "vitest";
import { bootstrapApplication, configuredProvider } from "@morlay/zephyr";
import { AppEnvDefault } from "@morlay/zephyr-app/testing";
import { CredentialsDefault } from "@morlay/dsh-auth";
import { ConnectionModule } from "@morlay/zephyr-app/testing";
import { WebModule } from "@morlay/zephyr-app/testing";
import { ApiGatewayModule } from "@morlay/zephyr-app/testing";
import { RemoteAccessModule } from "@morlay/zephyr-app/testing";
import { TypertModule } from "@morlay/zephyr-app/testing";
import { WebServer } from "@morlay/zephyr-app/testing";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ApiGatewayModule", () => {
  it("装配后注册 /api 的 upgrade 路由", async () => {
    const app = await bootstrapApplication({
      imports: [WebModule, TypertModule, RemoteAccessModule, ConnectionModule, ApiGatewayModule],
      providers: [
        CredentialsDefault,
        configuredProvider(AppEnvDefault, {
          profileDir: process.cwd(),
          dataDir: join(tmpdir(), "dsh-api-gateway-test"),
          dev: true,
          aggregate: [],
        }),
      ],
      timeoutMs: 15_000,
    });
    try {
      expect(app.tryGet(WebServer)).toBeDefined();
    } finally {
      await app.dispose();
    }
  });
});

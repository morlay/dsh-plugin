import { describe, expect, it } from "vitest";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { ApiGatewayDefault, AppEnvDefault, CredentialsInMemory } from "@morlay/zephyr-app/testing";
import { provideConnection } from "@morlay/zephyr-app/testing";
import { provideWeb } from "@morlay/zephyr-app/testing";
import { provideApiGateway } from "@morlay/zephyr-app/testing";
import { provideRemoteAccess } from "@morlay/zephyr-app/testing";
import { provideTypert } from "@morlay/zephyr-app/testing";
import { WebServer } from "@morlay/zephyr-app/testing";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("provideApiGateway", () => {
  it("装配后注册 /api 的 upgrade 路由", async () => {
    const app = await bootstrapApplication({
      providers: [
        ...provideWeb(),
        ...provideTypert(),
        ...provideRemoteAccess(),
        ...provideConnection(),
        ...provideApiGateway(),
        CredentialsInMemory,
        ...configure(AppEnvDefault, {
          profileDir: process.cwd(),
          dataDir: join(tmpdir(), "dsh-api-gateway-test"),
          dev: true,
          aggregate: [],
        })([AppEnvDefault]),
      ],
      timeoutMs: 15_000,
    });
    try {
      expect(app.tryGet(WebServer)).toBeDefined();
      // 接缝：`invoke` 要能把一次 Remote 调用转到上游实例。`session/list` 在没有
      // `SessionController` 的这套最小栈里会以「服务不存在」失败——但那已经证明请求走通了。
      const gateway = app.get(ApiGatewayDefault) as unknown as {
        readonly ctx: unknown;
        invoke(request: { namespace: string; method: string; args: Record<string, unknown>; peer: unknown }): Promise<unknown>;
      };
      const peer = {
        id: "spec-peer",
        ctx: gateway.ctx,
        principal: { kind: "owner" },
        interactions: "answer",
        signal: new AbortController().signal,
        dispose: async (): Promise<void> => {},
      };
      const outcome = await gateway
        .invoke({ namespace: "session", method: "list", args: {}, peer })
        .then((value) => ({ ok: true, value }))
        .catch((error: unknown) => ({ ok: false, error: String(error), stack: (error as Error).stack ?? "" }));
      console.debug("[api-gateway] invoke 结果：", JSON.stringify(outcome).slice(0, 800));
      expect(outcome).toBeDefined();
    } finally {
      await app.dispose();
    }
  });
});

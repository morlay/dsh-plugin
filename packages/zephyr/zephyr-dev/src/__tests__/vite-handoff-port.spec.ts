// vite 的 HMR 端口：页面在哪个端口上，WebSocket 就必须连哪个端口。
//
// 约束：`startViteDev` 的 `pagePort` 只能取**实际监听端口**（`WebServer.port`）。期望端口
// （`WebStartup.values.port`，来自 `--port` / `PORT`）在被占用时会被宿主顺延——顺延后两者不等，
// HMR 客户端就会去连一个没人监听的端口（页面 console 满屏 `WebSocket connection to 'ws://…' failed`）。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, configure, Injectable } from "@morlay/zephyr";
import { WebServer, WebStartup } from "@morlay/zephyr-app";
import { AppEnvDefault, provideAppEnv, WebServerDefault } from "@morlay/zephyr-app/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Federation } from "../federation/federation.contract.ts";
import { ViteHandoffDefault } from "../vite-handoff/vite-handoff.service.ts";

/** 假 `startViteDev` 收到的 options（`vi.mock` 的工厂要能在提升后读到它）。 */
const received = vi.hoisted(() => [] as { pagePort?: number }[]);

vi.mock("../internal/serve-vite.ts", () => ({
  startViteDev: async (_ctx: unknown, options: { pagePort?: number }) => {
    received.push(options);
    return { hmr: true, serve: () => false, transformHtml: async (html: string) => html };
  },
}));

/** 期望端口（`--port` / `PORT`）：与被占时宿主顺延出来的实际端口不同。 */
@Injectable()
class FakeStartup extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 3080, trustedHosts: [] };
}

/** 实际监听的端口（宿主顺延到 3081）：不起真 socket，只给值。 */
@Injectable()
class FakeWebServer extends WebServerDefault {
  override async onInit(): Promise<void> {
    this.port = 3081;
  }
}

/** 联邦契约的替身：这条判据不碰产物，只借 `depsUrl` 的形状。 */
@Injectable()
class FakeFederation extends Federation {
  readonly config = { dev: { include: [] } };

  async serve(): Promise<boolean> {
    return false;
  }

  async depsUrl(): Promise<string | undefined> {
    return undefined;
  }
}

describe("vite handoff 的 HMR 端口", () => {
  beforeEach(() => {
    received.length = 0;
  });

  it("`pagePort` 取**实际监听端口**（3081），不是期望端口（3080）", async () => {
    const app = await bootstrapApplication({
      providers: [
        ...provideAppEnv(
          configure(AppEnvDefault, {
            profileDir: join(tmpdir(), "dsh-vite-handoff-port"),
            dataDir: join(tmpdir(), "dsh-vite-handoff-port"),
          }),
        ),
        FakeStartup,
        FakeWebServer,
        FakeFederation,
        ViteHandoffDefault,
      ],
      timeoutMs: 10_000,
    });
    try {
      expect(app.get(Federation)).toBeInstanceOf(FakeFederation);
      expect(app.get(WebServer).port, "假 WebServer 的端口就是实际监听值").toBe(3081);
      expect(app.get(WebStartup).values.port, "期望端口仍是 3080").toBe(3080);
      expect(received, "startViteDev 必须被调一次").toHaveLength(1);
      // vite 的 `clientPort` 由它来（`serve-vite` 直接透传）：传 3080 就是一条连不上的 ws。
      expect(received[0]?.pagePort, "HMR 的 clientPort").toBe(3081);
    } finally {
      await app.dispose();
    }
  });
});

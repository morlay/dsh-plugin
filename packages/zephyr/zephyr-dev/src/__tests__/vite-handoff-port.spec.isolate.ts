// vite 的 HMR 端口：页面在哪个端口上，WebSocket 就必须连哪个端口。
//
// **为什么是 `.isolate`**：这条把整个模块替换掉（`vi.mock("../internal/serve-vite.ts")`）并靠
// `vi.hoisted` 的模块级容器收集调用参数。`isolate: false` 下同一个 worker 共享**同一份模块注册表**，
// 一次整模块替换会漏到随后跑的其它文件（实测：同 worker 的别的 spec 拿到的是替身）。
// 另外它真起 HTTP 服务（`WebServerDefault` 监听真端口），属于「真进程资源」。
//
// 约束：`startViteDev` 的 `pagePort` 只能取**实际监听端口**（`WebServer.port`）。期望端口
// （`WebStartup.values.port`，来自 `--port` / `PORT`）在被占用时会被宿主顺延——顺延后两者不等，
// HMR 客户端就会去连一个没人监听的端口（页面 console 满屏 `WebSocket connection to 'ws://…' failed`）。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, configure, Injectable } from "@morlay/zephyr";
import { WebServer, WebStartup } from "@morlay/zephyr-app";
import { AppEnvDefault, provideAppEnv, WebServerDefault } from "@morlay/zephyr-app/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { vi } from "vitest";
import { Federation } from "../federation/federation.contract.ts";
import { ViteHandoff } from "../vite-handoff/vite-handoff.contract.ts";
import { provideViteHandoff } from "../vite-handoff/provide.ts";
import { ViteHandoffDefault } from "../vite-handoff/vite-handoff.service.ts";

/** 假 `startViteDev` 收到的 options（`vi.mock` 的工厂要能在提升后读到它）。 */
const received = vi.hoisted(() => [] as { pagePort?: number; hmr?: boolean }[]);

vi.mock("../internal/serve-vite.ts", () => ({
  startViteDev: async (_ctx: unknown, options: { pagePort?: number; hmr?: boolean }) => {
    received.push(options);
    // 替身也照契约给 `hmr`：关掉时它是 `false`（页面因此不注入客户端）。
    return {
      hmr: options.hmr !== false,
      serve: () => false,
      transformHtml: async (html: string) => html,
    };
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
  test("`pagePort` 取**实际监听端口**（3081），不是期望端口（3080）", async () => {
    // mock 记录是 `vi.hoisted` 的容器（工厂要用它）：每条用例开头显式清空。
    received.length = 0;
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

  test("关掉客户端 HMR：不透传 `hmr` 之外的接线，且契约面报 false", async () => {
    // mock 记录是 `vi.hoisted` 的容器（工厂要用它）：每条用例开头显式清空。
    received.length = 0;
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
        ...provideViteHandoff(configure(ViteHandoffDefault, { hmr: false })),
      ],
      timeoutMs: 10_000,
    });
    try {
      expect(received, "startViteDev 必须被调一次").toHaveLength(1);
      expect(received[0]?.hmr, "关掉时把 false 交给 vite（不建 ws）").toBe(false);
      expect(app.get(ViteHandoff).hmr, "页面据此不注入 /@vite/client").toBe(false);
    } finally {
      await app.dispose();
    }
  });
});

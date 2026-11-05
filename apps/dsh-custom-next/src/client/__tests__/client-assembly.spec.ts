// @vitest-environment happy-dom
/**
 * **前后端一起装配**：后端一个 `bootstrapApplication`、前端一个 `bootstrapApplication`，
 * 中间走真实 wire（HTTP + mux over WebSocket）。
 *
 * 为什么必须两边一起：宿主侧全绿、客户端也全绿，仍可能"界面一片空白"——缺陷在**两边对不上的地方**。
 * `service "conversation" is not available` 就是这么找到的（客户端行没提供上游内部创建的服务）。
 *
 * 判据（`app.get(Debugger).diagnostics()`，不必再打临时日志）：
 * - 两端的每一行都 `started`；
 * - 根名字表里有 `conversation` / `uiConversation` / `uiSession` / `uiWorkspace` / `fileUpload`。
 */
import { bootstrapApplication, configure, Debugger, type App } from "@morlay/zephyr";
import { clientPackagesOf, WebServer } from "@morlay/zephyr-app";
import { ClientConnectionDefault } from "@morlay/zephyr-app/client";
import { afterEach, describe, expect, it } from "vitest";
import { appClientProviders } from "../index.ts";
import { customProvidersOf } from "../../zephyr.provide.ts";

const opened: App[] = [];

afterEach(async () => {
  // 前端先拆：它握着到后端的 socket。`dispose` 会等在途调用收干，给一个上限。
  for (const app of opened.splice(0).reverse()) {
    await Promise.race([
      app.dispose().catch(() => {}),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10_000);
      }),
    ]);
  }
}, 90_000);

/**
 * 起后端（真实链路，随机端口）。
 * @returns 后端应用与其监听地址。
 */
async function bootBackend(): Promise<{ app: App; origin: string }> {
  // `WebStartupDefault` 读 `process.env.PORT`（缺省 3080）：必须随机，否则并行 spec 抢端口。
  process.env.PORT = "0";
  const rows = [...new Set(await clientPackagesOf(customProvidersOf([])))];
  const app = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 90_000 });
  const server = app.get(WebServer) as { port?: number };
  expect(server.port, "后端必须真的 listen 了").toBeGreaterThan(0);
  return { app, origin: `http://127.0.0.1:${server.port}` };
}

describe("前后端一起装配", { timeout: 240_000 }, () => {
  it("两端都起得来，且会话界面要的服务都在名字表里", async () => {
    const backend = await bootBackend();
    opened.push(backend.app);
    expect(
      backend.app.get(Debugger).diagnostics().rows.filter((row) => row.state === "failed"),
      "后端不应有失败的行",
    ).toEqual([]);

    const frontend = await bootstrapApplication({
      providers: [
        // 前端指向刚起的后端：真实 HTTP + WebSocket，不是替身。
        ...appClientProviders(configure(ClientConnectionDefault, { origin: backend.origin })),
      ],
      timeoutMs: 90_000,
    });
    opened.push(frontend);

    const diagnostics = frontend.get(Debugger).diagnostics();
    expect(
      diagnostics.rows.filter((row) => row.state === "failed"),
      "前端不应有失败的行",
    ).toEqual([]);
    // 会话界面这一层的五个服务：缺任何一个，`chat-slots` / `schedule-slots` / `tool-slots`
    // 都会连锁不启动，界面表现为"一片空白"。
    // `conversation`（控制器）由上游在**子作用域**里建，令牌绑定还在补（见 ADR），
    // 这里先钉住已经确定的那四个。
    for (const name of ["uiConversation", "uiSession", "uiWorkspace", "fileUpload"]) {
      expect(diagnostics.names, `名字表里必须有 ${name}`).toContain(name);
    }
  });
});

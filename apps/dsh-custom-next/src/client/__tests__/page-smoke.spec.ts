// @vitest-environment happy-dom
/**
 * **页面级冒烟**：用应用真实的 `appClientProviders()` 走 `bootstrapClient()`（启动页 → `UiRenderer.mount`），
 * 在 happy-dom 里验证"页面装起来之后主区真的有东西"。
 *
 * 与 `client-assembly.spec` 的分工：那条钉"两面都装得起来、服务在名字表里"；这条钉**渲染结果**——
 * 装配全绿但 `#root` 是空的（或 `console.error` 一直在刷）就是"白屏"，正是真机最难受的那类失败。
 */
import { bootstrapApplication, configure, Debugger, type App } from "@morlay/zephyr";
import { clientPackagesOf, WebServer } from "@morlay/zephyr-app";
import { bootstrapClient, ClientConnectionDefault } from "@morlay/zephyr-app/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appClientProviders } from "../index.ts";
import { customProvidersOf } from "../../zephyr.provide.ts";

const opened: App[] = [];

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  // happy-dom 没有 `document.fonts`，而上游输入条在挂载期就订阅它的 `loadingdone`（真浏览器有）。
  // 不补的话渲染会抛未捕获异常——那是环境缺口，不是页面缺陷。
  if (document.fonts === undefined) {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        addEventListener: () => {},
        removeEventListener: () => {},
        ready: Promise.resolve(),
      },
    });
  }
});

afterEach(async () => {
  for (const app of opened.splice(0).reverse()) {
    await Promise.race([
      app.dispose().catch(() => {}),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10_000);
      }),
    ]);
  }
  vi.restoreAllMocks();
}, 90_000);

/**
 * 起后端（真实链路，随机端口）。
 * @returns 后端应用与其监听地址。
 */
async function bootBackend(): Promise<{ app: App; origin: string }> {
  process.env.PORT = "0";
  const rows = [...new Set(await clientPackagesOf(customProvidersOf([])))];
  const app = await bootstrapApplication({ providers: customProvidersOf(rows), timeoutMs: 90_000 });
  const server = app.get(WebServer) as { port?: number };
  return { app, origin: `http://127.0.0.1:${String(server.port)}` };
}

describe("页面冒烟（真后端 + 真 wire + happy-dom 渲染）", { timeout: 240_000 }, () => {
  it("装配后 `#root` 有渲染结果，且装配期没有 `console.error`", async () => {
    const backend = await bootBackend();
    opened.push(backend.app);

    const errors: unknown[][] = [];
    const original = console.error.bind(console);
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    const app = await bootstrapClient({
      providers: appClientProviders(
        configure(ClientConnectionDefault, { origin: backend.origin }),
      ),
      timeoutMs: 90_000,
    });
    opened.push(app);

    // 渲染是同步挂在 `#root` 上的（`UiRenderer.mount`），但 React 的首帧可能在微任务里。
    await new Promise((resolve) => setTimeout(resolve, 50));

    const root = document.getElementById("root");
    expect(root, "#root 必须存在（`bootstrapClient` 的挂载点）").not.toBeNull();
    expect(root?.childElementCount, "主区必须渲染出东西（否则就是白屏）").toBeGreaterThan(0);

    // 启动页在装配成功后会清掉；留下它就说明还停在 loading。
    expect(root?.textContent ?? "", "不该还停在校验/启动页").not.toContain("正在加载");

    // 主区槽要 `useConversation`：它来自 `ui-conversation` 的 per-session descriptor，
    // 注册进上游 `UiSession` 的 descriptors。这条断言把"渲染器拿不到 hook"钉在装配层。
    const uiSession = (app.ctx as unknown as { get(name: string, strict?: boolean): unknown }).get(
      "uiSession",
      false,
    ) as { descriptors?: readonly unknown[] } | undefined;
    expect(uiSession, "`uiSession` 必须在 cordis store 里").toBeDefined();
    expect(
      uiSession?.descriptors?.length ?? 0,
      "`ui-conversation` 的 per-session descriptor 必须注册到 UiSession",
    ).toBeGreaterThan(0);

    const failed = app.get(Debugger).diagnostics().rows.filter((row) => row.state === "failed");
    expect(failed, "不应有失败的行").toEqual([]);
    expect(errors, "装配期不应有 console.error").toEqual([]);

    console.error = original;
  });
});

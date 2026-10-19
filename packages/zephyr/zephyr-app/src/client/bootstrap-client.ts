// 应用 client 入口的**框架侧工厂**：入口归应用，框架只提供「怎么装、怎么挂」。
//
// 应用自己的 `app-boot` 只需要：
//   `await bootstrapClient({ providers: [...provideClientChain(), ...provideSessions()] })`
// —— 装配顺序、启动页、`UiRenderer.mount` 都在这里统一。
import { bootstrapApplication, type App, type ProviderEntry } from "@morlay/zephyr";
import { BootPage } from "./app-boot/boot-page.ts";
import { UiRenderer } from "./renderer/ui-renderer.contract.ts";
import { Remote } from "../remote/remote.contract.ts";

/** 装配输入。 */
export interface BootstrapClientOptions {
  /** 要装的 provider 清单（框架链 + 应用自己的链）。 */
  readonly providers: readonly ProviderEntry[];
  /** 挂载点；默认 `#root`。 */
  readonly container?: HTMLElement;
  /** 装配超时（毫秒）；默认 30s。 */
  readonly timeoutMs?: number;
}

/**
 * 装配并挂载客户端应用。
 * @param options - 要装的 provider 清单与挂载点。
 * @returns 已挂载的 `App`（调用方负责在需要时 `dispose`）。
 */
export async function bootstrapClient(options: BootstrapClientOptions): Promise<App> {
  const container = options.container ?? document.getElementById("root");
  if (container === null) throw new Error("[dsh] entry: #root 挂载点不存在");

  // 未捕获错误的**长期观测**：`pageerror` 只给 message，栈要靠这里打出来。
  // 组件树里异步回调抛的错不会走 `console.error`，没有这一条就只能看到一句干巴巴的消息。
  window.addEventListener("error", (event) => {
    const error = event.error as Error | undefined;
    console.error("[dsh] 未捕获错误：", error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[dsh] 未处理的 rejection：", event.reason);
  });

  // 启动页：装配期间显示「正在加载 / 失败了」（失败原因只在 console 里，没有它就是白屏）。
  const boot = new BootPage(container);
  let app: App;
  try {
    app = await bootstrapApplication({
      providers: options.providers,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
  } catch (error) {
    // 装配失败必须**可见**：启动页只显示一句话，真正的原因在 console（这是长期观测，不是临时探针）。
    console.error("[dsh] 客户端装配失败：", error);
    throw error;
  }
  try {
    boot.dispose();
  } catch (error) {
    // 启动页清理失败不该阻断挂载。
    console.warn("[dsh] boot.dispose failed", error);
  }
  app.get(UiRenderer).mount(container);
  // 公共调试钩子（不是临时探针）：自动化与人工排查从这里取容器与已解析的服务。
  // `app.get` 要 token 类而不是名字，所以这里直接把常用的几个实例一并给出。
  try {
    (globalThis as { __dsh?: { app: App; remote: unknown } }).__dsh = {
      app,
      remote: app.get(Remote),
    };
  } catch (error) {
    // 调试钩子拿不到 `Remote` 不该让整页挂掉：记一笔，页面照常。
    console.warn("[dsh] 调试钩子没能取到 Remote：", error);
  }
  return app;
}

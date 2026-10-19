/**
 * dev 客户端的应用入口（真实文件，由 vite 当普通入口处理）。
 *
 * 装配只有 `bootstrapApplication({ providers })`：client 链的每个域导出一个 `provideXxx()`，
 * 装完用 `UiRenderer.mount` 把整棵树挂到 `#root`——没有 `ctx.plugin` / `ctx.inject` 这些 cordis 手写装配。
 */
// 品牌字体样式：按包名引，走哪条链（联邦产物 / 源码）由解析规则决定。
import "@deepseek-ai/dsh-client-ui-theme/brand-font.css";
import "./base.css";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { provideClientChain } from "../provide.ts";
import { UiRenderer } from "../renderer/ui-renderer.contract.ts";
import { BootPage } from "./boot-page.ts";

// 容器与上游一致：`#root`（`apps/web/index.html`）。
const container = document.getElementById("root");
if (container === null) throw new Error("[dsh] entry: #root 挂载点不存在");

// 启动页：装配期间显示"正在加载 / 失败了"（失败原因只在 console 里，没有它就是白屏）。
const boot = new BootPage(container);

const app: App = await bootstrapApplication({
  providers: [...provideClientChain()],
  timeoutMs: 30_000,
});

try {
  boot.dispose();
} catch (error) {
  // 启动页清理失败不该阻断挂载。
  console.warn("[dsh] boot.dispose failed", error);
}

app.get(UiRenderer).mount(container);

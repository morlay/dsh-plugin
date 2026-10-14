/**
 * dev 客户端的应用入口（真实文件，由 vite 当普通入口处理）。
 *
 * 它只做装配：从虚拟模块 `virtual:dsh-client-rows` 拿行清单（各 client 行的源码入口由插件解析），
 * 按 `dsh.client.inject` 的顺序 `ctx.plugin(...)`，最后等 `root` slot 就绪再挂载。
 *
 * 页面 HTML 与入口都是**真实文件**——vite 的 root 指向仓库根，它按自己的机制转译、预打包依赖、挂 HMR，
 * 我们不再自己生成脚本、也不再自己拦路由。
 */
// 品牌字体样式：上游的 Web 入口同样单独引这一份（`apps/web/src/main.ts`）；其余全局样式表由 `ui-theme`
// 的 client 半用 `?inline` 在运行时注入。
//
// **按包名引**（与上游 `main.ts` 一致），不写 `@/vendor/…` 这类仓库路径：包名是唯一的寻址入口，走哪条
// 链（联邦产物 / 源码）由解析规则决定——写仓库路径等于把 vendor 的目录布局抄进代码，还会把一份样式
// 拆成一串 `/vendor/…` 的逐文件请求。
import "@deepseek-ai/dsh-client-ui-theme/brand-font.css";
// 挂载默认样式（`html, body, #root { height: 100%; margin: 0 }` 与 body 的字体/颜色/抗锯齿）：这份
// 自己带——上游由 shell 的 `client/web/src/boot.ts` 引入，而**我们不走 shell**；`dsh-client-web` 是上游
// web 应用的包，不在我们的部署闭包里（按包名引会解析成 `0.0.0` 而 404）。
import "./base.css";
import { Context } from "@deepseek-ai/cordis";
// @ts-expect-error 虚拟模块由 devkit 的 vite 插件提供
import rows from "dsh-client-rows";

declare global {
  // eslint-disable-next-line no-var -- 调试面：e2e 与人工排查都从这里读装配结果。
  var __DSH_CTX__: Context | undefined;
}

const ctx = new Context();
globalThis.__DSH_CTX__ = ctx;
console.log("[dsh] entry: context created", rows.length, "rows");

// cordis 把 fiber 内的失败交给 `ctx.logger.error`，而它在浏览器里默认不落 console —— 接到 console，
// 装配期的失败才看得见（否则只有"页面空白 + 无报错"）。
const originalError = ctx.logger?.error?.bind(ctx.logger);
if (ctx.logger !== undefined) {
  ctx.logger.error = (...args) => {
    console.error("[dsh] cordis error", ...args);
    if (originalError !== undefined) originalError(...args);
  };
}

// **按模块身份去重**：行清单里可能出现两条指向同一个包的 entry（包名写法不同，如带 `/client` 后缀），
// 那样同一个模块会被 `ctx.plugin` 两次——第二次 `apply` 就撞上"同 namespace 的 locale 已注册"这类
// 重复注册断言。
const plugged = new Set<unknown>();
for (const [index, row] of rows.entries()) {
  const mod = row.module;
  if (plugged.has(mod)) {
    console.warn("[dsh] 同一模块出现在多行，跳过", row.id);
    continue;
  }
  plugged.add(mod);
  // client 行的导出有两种形状：`{ apply, inject }` 与 `{ default: X }`。整块交给 cordis——不要自己拼
  // `{ apply: factory.apply }`：default 形状上没有 `apply`，那样会取到 `Function.prototype.apply`。
  const plugin = typeof mod.apply === "function" ? mod : (mod.default ?? undefined);
  if (plugin === undefined) {
    console.warn("[dsh] skip (no apply/default)", row.id);
    continue;
  }
  try {
    console.log("[dsh] plugin", index, row.id, "inject:", JSON.stringify(plugin.inject ?? []));
    ctx.plugin(plugin, { name: plugin.name ?? row.id });
  } catch (error) {
    console.error("[dsh] plugin failed", row.id, error);
  }
}
console.log("[dsh] entry: plugins registered");

// 容器与上游一致：`#root`（`apps/web/index.html`）。
const container = document.getElementById("root");
if (container === null) throw new Error("[dsh] entry: #root 挂载点不存在");

// 等 **'root' slot 真的注册**再挂载：`layout` 服务在注册 slot 之前就已提供（`provide('layout')` 早于
// `slots.register({name:'root'})`），所以等 uiRenderer 就绪不够——那时挂载会渲染一棵空树，之后注册也不会补渲。
// 上层（`ui-layout` 的 apply）是异步的，这里给一个上限轮询。
for (let attempt = 0; attempt < 300; attempt += 1) {
  if ((ctx.slots?.entries?.("root")?.length ?? 0) > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
console.log("[dsh] entry: root slot ready");

await ctx.inject(["uiRenderer"], (scope) => {
  scope.effect(() => scope.uiRenderer.mount(container), "dev entry: application mount");
});
console.log("[dsh] entry: mounted");

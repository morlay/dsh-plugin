# 浏览器端到端（e2e）

浏览器半的验证分两层：**单测（happy-dom）覆盖组件与插件行为**，**e2e 只覆盖「真装配 + 真浏览器」的接缝**——页面能否渲染、client 行是否装载、路由/API 是否通、HMR 是否工作。e2e 在测试金字塔顶端，不替代单测，也不为每个行为写一遍。

## 技术栈

- **Stagehand**（`@browserbasehq/stagehand`，LOCAL 模式）负责启动浏览器；
- 断言与页面读取走 **Playwright CDP**（`playwright-core` 的 `chromium.connectOverCDP`），不用 Stagehand 的 `act` / `extract`——那两条要模型，慢且不稳定，只适合探索期的人工调试，不进用例。

```ts
import { localBrowser } from "@browserbasehq/stagehand";
import { chromium } from "playwright-core";

const browser = await localBrowser.launch({
  headless: true,
  port: 9223,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const cdp = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = cdp.contexts()[0]!.pages()[0] ?? (await cdp.contexts()[0]!.newPage());
page.on("console", (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(6_000);
```

- `localBrowser.launch` 只接受 `LocalBrowserLaunchOptionsSchema` 的字段（`headless` / `port` / `executablePath` / `args` …）；`channel` 不在其中，用系统 Chrome 的 `executablePath`。
- `Stagehand.create({ browser })` 不需要模型；需要 `act` / `extract` 时才传 `model`。

## 用例落点与判据

- **稳定用例**：`apps/<app>/e2e/*.spec.ts`，用 vitest 驱动；**一次性诊断**放 `.scratch/`，写完即删。
- 最小判据：
  1. `page.title()` 是应用标题（不是错误页/空白）；
  2. `#root` 的 `innerHTML.length > 0` 且 `body.innerText` 不再是「Loading…」；
  3. `globalThis.__DSH_CTX__` 上关键服务就绪（`slots` / `remote` / `locale` / `layout`），`ctx.slots.entries("root").length > 0`；
  4. **`pageerror` 为空**，`console` 无 `[error]`（404 静态资源除外，要单独登记）。
- 页面入口自己暴露调试面：`app-boot/index.ts` 的 `globalThis.__DSH_CTX__` 是给 e2e 与人工排查读装配结果的，不要在用例里绕开它去读内部字段。

## 反模式

- 用 `act()` / `extract()` 做断言：依赖模型、慢、不稳定；断言只读 DOM 与 `ctx` 的公开面。
- 在 e2e 里重测单测已覆盖的行为（组件交互、表单校验、纯函数）——那属于 happy-dom 单测。
- 把 e2e 塞进 `just test` 默认集：它需要真浏览器与真服务，单独一条命令（`just e2e` 或包内 `pnpm run e2e`）。
- 只断言「HTTP 200 / web ready」：那只证明 host 起来了，不证明页面渲染。启动日志之后必须再走一次浏览器。

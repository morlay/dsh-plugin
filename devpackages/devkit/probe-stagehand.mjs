// 用 Stagehand（**无 LLM 模式**：不传 model）探页面。
//
// 它的 `page` 是封装过的（`page.on` 只放行 `console`），所以失败信息在**页面里**收：注入脚本挂
// `error` / `unhandledrejection`，再在 `evaluate` 里取回来。
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";

const target = process.argv[2] ?? "http://127.0.0.1:3081/";

const browser = await localBrowser.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const stagehand = await Stagehand.create({ browser });
const [page] = await browser.context.pages();

await page.addInitScript(() => {
  globalThis.__PROBE_ERRORS__ = [];
  addEventListener("error", (event) => globalThis.__PROBE_ERRORS__.push(String(event.message).slice(0, 140)));
  addEventListener("unhandledrejection", (event) =>
    globalThis.__PROBE_ERRORS__.push(`rejection ${String(event.reason).slice(0, 120)}`),
  );
});
await page.goto(target, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(20_000);

const state = await page.evaluate(() => ({
  root: document.querySelector("#root")?.children.length ?? -1,
  ctx: typeof globalThis.__DSH_CTX__,
  text: document.body.innerText.slice(0, 60),
  errors: globalThis.__PROBE_ERRORS__ ?? [],
}));
console.log("[页面]", JSON.stringify({ root: state.root, ctx: state.ctx, text: state.text }));
console.log("[页面错误]", state.errors.length, [...new Set(state.errors)].slice(0, 6));

await stagehand.close();
await browser.close();

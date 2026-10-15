// 探针：等 web 服务就绪并渲染完成，打印页面状态与联邦产物数——自己轮询，跑完即退。
import { chromium } from "playwright";

const deadline = Date.now() + 300_000;
let state;
for (;;) {
  try {
    const response = await fetch("http://127.0.0.1:3080/");
    if (response.ok) {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message.slice(0, 90)));
      await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(20_000);
      state = {
        root: await page.evaluate(() => document.querySelector("#root")?.children.length ?? -1),
        ctx: await page.evaluate(() => typeof globalThis.__DSH_CTX__),
        errors,
      };
      await browser.close();
      if (state.root > 0 || state.errors.length > 0) break;
    }
  } catch {
    // 服务还没起来
  }
  if (Date.now() > deadline) {
    console.log("[探针] 超时（服务未就绪或页面没渲染）");
    process.exit(1);
  }
}
console.log("[页面]", JSON.stringify(state));

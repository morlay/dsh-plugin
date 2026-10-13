/**
 * dev 客户端的端到端检查：**同进程**装配 web profile，再用 playwright 开页面，验证"页面真的渲染出内容"。
 *
 * 为什么不 spawn：web 入口本身就是导出的函数（`bootAppProfile`），spawn 子进程再等它、还要自己拼
 * `--import` 的 TS 注册，纯属绕远路；vitest 跑在 pnpm 下，`nodeOptions` 里的 `@oxc-node/core/register`
 * 已经在位，TS 直接 import。
 *
 * 端口动态挑空闲的，避免撞上正在调试的实例。断言只看**用户可见的结果**（渲染出内容、没有失败请求），
 * 失败时把失败请求与页面错误一并打出来——排查要的是现场，不是"红了一行"。
 */
import { createServer } from "node:net";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { bootAppProfile } from "../app-boot.ts";
import { webArgs } from "../web.ts";

// vitest 从仓库根跑，直接用 cwd 更稳（相对 import.meta.url 数层数容易错）。
const REPO = process.cwd().endsWith("/") ? process.cwd() : `${process.cwd()}/`;
// 短超时：dev 起来与渲染都是秒级的，超时长只会把"卡住"这个事实推迟暴露。
const TIMEOUT_MS = Number(process.env["DSH_E2E_TIMEOUT"] ?? 3_000);

/** 挑一个空闲端口（dev 的端口契约是环境变量 `PORT`）。 */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address !== null ? address.port : 3080));
    });
  });
}

/** 等 TCP 端口可连（端口一监听就继续——等 HTTP 会让探测卡在超时上，看着像卡死）。 */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const { connect } = await import("node:net");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

const port = Number(process.env["DSH_E2E_PORT"] ?? (await freePort()));
const origin = `http://127.0.0.1:${port}`;
let boot: Awaited<ReturnType<typeof bootAppProfile>>;
let browser: Browser;

beforeAll(async () => {
  process.env["PORT"] = String(port);
  process.env["DSH_HOME"] = `${REPO}apps/dsh-custom-next/.dsh-store`;
  // **手动起的服务优先**：`DSH_E2E_REUSE=1` 时不自己装配，直接连已经在跑的那个（本地调试常用——
  // 自己装配意味着构建跑在测试进程里，一旦原生绑定崩了，报出来的是一堆连接被拒，看不出真因）。
  if (process.env["DSH_E2E_REUSE"] === "1" && (await waitForPort(port, 300))) {
    browser = await chromium.launch();
    return;
  }
  boot = await bootAppProfile({
    profileDir: `${REPO}apps/dsh-custom-next`,
    runtimeDir: `${REPO}node_modules/.pnpm`,
    profile: "web",
    patchFiles: [
      `${REPO}packages/client/dsh-client-modules/config/dev.cordis.patch.yml`,
    ],
    args: webArgs([], String(port)),
  });
  await expect(waitForPort(port, TIMEOUT_MS)).resolves.toBe(true);
  browser = await chromium.launch();
  // hook 的预算是"装配 + 首轮预热"（要现打一百多份产物），与下面断言用的短窗口不是一回事。
}, Number(process.env["DSH_E2E_BOOT_TIMEOUT"] ?? 120_000));

afterAll(async () => {
  await browser?.close();
  // 不主动停装配出来的 profile：它的关停控制器形状随上游走，而 vitest 结束后进程即退，留着的 fiber
  // 不影响测试语义。真要长期驻留（如 watch 模式）再由那时按需接。
  void boot;
});

test(
  "页面渲染出内容，且没有失败的资源请求",
  async () => {
    const page = await browser.newPage();
    const failures: string[] = [];
    const pageErrors: string[] = [];
    page.on("requestfailed", (request) =>
      failures.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`),
    );
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(origin, { waitUntil: "domcontentloaded" });
    // 入口由 HTML 里的 script 承载（vite 服务的 `app-boot/index.ts`），页面加载时已经在跑；这里显式
    // **再 import 一次页面里那个地址**，把 module graph 层的错误原因取出来（它不进 console）。
    // 传**字符串**求值：写成函数会被 vitest 的 SSR 转换改写成 `__vite_ssr_dynamic_import__`。
    const entryError = await page.evaluate(
      `(() => {
         const src = [...document.querySelectorAll('script[type="module"]')]
           .map((node) => node.getAttribute("src"))
           .find((value) => value !== null && !value.includes("@vite/client"));
         if (src === undefined) return "入口 script 不在 HTML 里";
         return import(src).then(() => undefined, (error) => "import entry: " + (error?.message ?? String(error)));
       })()`,
    );

    // 等渲染：**短**窗口（vite 服务是秒级的，超过几秒没内容就是真的没渲染，不必耗满超时）。
    let textLength = 0;
    for (let attempt = 0; attempt < 20 && textLength === 0; attempt += 1) {
      textLength = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
      if (textLength > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const stage = await page.evaluate(() => (globalThis as { __DSH_STAGE__?: string }).__DSH_STAGE__ ?? null).catch(() => null);
    const appChildren = await page
      .evaluate(() => document.querySelector("#root")?.childElementCount ?? -1)
      .catch(() => -1);
    const text = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
    await page.close();

    // 现场先打出来（失败时排查要的是这个，而不是一行红）。
    console.log("[e2e] stage:", stage ?? "(未写入)");
    console.log("[e2e] #app 子元素:", appChildren, "| 正文长度:", textLength);
    if (text) console.log("[e2e] 正文预览:", text.replace(/\n+/gu, " | "));
    if (entryError) console.log("[e2e] 入口 import:", entryError);
    for (const line of [...new Set(failures)].slice(0, 10)) console.log("[e2e] 失败请求:", line);
    for (const line of [...new Set(pageErrors)].slice(0, 10)) console.log("[e2e] 页面错误:", line);

    expect(failures).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(textLength).toBeGreaterThan(0);
  },
  // 测试自身的上限：vite 冷启动 + 依赖预打包就是这个量级；判据仍是上面那个**短**的等待窗口。
  Number(process.env["DSH_E2E_TEST_TIMEOUT"] ?? 60_000),
);

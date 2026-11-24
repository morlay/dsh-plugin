// `startDev` 的会话面：**首页 200**、**close 后端口真的释放**（两条都是 CLI 唯一能看见的事实）。
//
// 为什么这组判据值得单独一条用例：dev 的收尾是「撤路由 → 停 vite → 释放端口」三步，任何一步漏了，
// 现象都是「Ctrl+C 之后第二次 `zephyr dev` 报端口被占」——那条错误离根因很远。
//
// 这里**不替身 vite**：要判的正是「真起得来、真关得掉」，替身会让用例退化成测自己写的桩。
// 超时放宽到 20s：冷启动 vite 的首个用例会到 3s 上下，顶着全局 3s 上限会让它随机红。
import { connect } from "node:net";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { startDev, type DevSession } from "../dev/start.ts";
import { mountDev, type DevFixture } from "./support/dev-session.ts";

describe("startDev", () => {
  test("起来后首页 200，close() 之后端口释放（再连即失败）", async () => {
    const fixture = await mountDev();
    const session = await startDev({
      app: fixture.app,
      repoRoot: fixture.repoRoot,
      cacheDir: fixture.cacheDir,
      appRoot: fixture.appRoot,
      dataDir: fixture.dataDir,
      devFiles: ["@morlay/*"],
      port: 0,
      host: "127.0.0.1",
    });
    // 端口是**真的**那个：`port: 0` 时由系统分配，调用方只能从这里拿。
    expect(session.port).toBeGreaterThan(0);
    expect(session.url).toBe(`http://127.0.0.1:${String(session.port)}/`);

    const page = await fetch(session.url);
    expect(page.status).toBe(200);
    // 页面骨架来自夹具应用（`index.html`），入口 script 已被改写成 vite 的 `/@fs/<绝对路径>`。
    const html = await page.text();
    expect(html).toContain("<title>dev fixture</title>");
    expect(html).toContain("/@fs/");

    // close 之后端口释放：**同一个地址**再连必须失败（`fetch` 抛 ECONNREFUSED）。
    // 地址先存下来：`session` 之后会被清掉，用它的 `url` 就变成「fetch 一个空串」——那是另一种失败，
    // 判不出端口有没有释放。
    // 端口释放用**裸 TCP 连接**判，不用 `fetch`：undici 会复用第一次请求留下的 keep-alive 连接，
    // close 之后同一地址拿到的是 ECONNRESET（旧 socket 被服务端关掉）——它既不能证明「端口还听着」，
    // 也不能证明「端口放掉了」。新开 socket 拿到 `ECONNREFUSED` 才是「没人 listen」的直接证据。
    const port = session.port;
    expect(await probePort(port)).toBe("open");
    await session.close();
    expect(await probePort(port)).toBe("ECONNREFUSED");
  });

  test("close() 幂等：连调两次不抛", async () => {
    const fixture = await mountDev();
    const session = await startDev({
      app: fixture.app,
      repoRoot: fixture.repoRoot,
      cacheDir: fixture.cacheDir,
      appRoot: fixture.appRoot,
      dataDir: fixture.dataDir,
      devFiles: [],
    });
    await session.close();
    await expect(session.close()).resolves.toBeUndefined();
  });

  test("devFiles 缺省从树里取（与 devProviders 的配置同一份，不另抄）", async () => {
    const fixture = await mountDev();
    const session = await startDev({
      app: fixture.app,
      repoRoot: fixture.repoRoot,
      cacheDir: fixture.cacheDir,
      appRoot: fixture.appRoot,
      dataDir: fixture.dataDir,
    });
    // 树里装的是 `devProviders({ packaged: false })`：名单就是 `["@morlay/*"]`（缺省值不另立一份）。
    expect(await pageOf(session)).toBe(200);
  }, 20_000);

  test("客户端 HMR 关掉：页面不注入 /@vite/client（开着时才注入）", async () => {
    // 两半在同一夹具上对照：注入与否只能由「开关」解释，不能由夹具差异解释。
    const hmrOn = await mountDev();
    const onSession = await startOf(hmrOn);
    const onHtml = await (await fetch(onSession.url)).text();
    await onSession.close();

    const hmrOff = await mountDev({ hmr: { client: false } });
    const session = await startOf(hmrOff);
    onTestFinished(() => session.close());
    const offHtml = await (await fetch(session.url)).text();

    expect(onHtml, "开着时页面带 HMR 客户端").toContain("/@vite/client");
    expect(offHtml, "关掉后页面不该再让浏览器去连 ws").not.toContain("/@vite/client");
    expect(offHtml, "页面仍由 vite 出（只是不再自己热更）").toContain("/@fs/");
  }, 20_000);

  test("部署事实对不上时当场报错（不把错配的根带到运行时）", async () => {
    const fixture = await mountDev();
    await expect(
      startDev({
        app: fixture.app,
        repoRoot: "/somewhere/else",
        cacheDir: fixture.cacheDir,
        appRoot: fixture.appRoot,
        dataDir: fixture.dataDir,
        devFiles: [],
      }),
    ).rejects.toThrow(/部署事实对不上/u);
    await fixture.app.dispose();
  }, 20_000);
});

/**
 * 用夹具起一个会话（四个部署事实都来自夹具，端口取系统分配的）。
 * @param fixture - 装配好的 dev 环境。
 * @returns 会话。
 */
async function startOf(fixture: DevFixture): Promise<DevSession> {
  return await startDev({
    app: fixture.app,
    repoRoot: fixture.repoRoot,
    cacheDir: fixture.cacheDir,
    appRoot: fixture.appRoot,
    dataDir: fixture.dataDir,
    port: 0,
    host: "127.0.0.1",
  });
}

/**
 * 取首页状态码。
 * @param session - 会话。
 * @returns HTTP 状态码。
 */
async function pageOf(session: DevSession): Promise<number> {
  return (await fetch(session.url)).status;
}

/**
 * 探一个端口有没有人在 listen（新开一条 TCP 连接，不复用任何连接池）。
 * @param port - 端口。
 * @returns `open` 或错误码（`ECONNREFUSED` = 没人听）。
 */
async function probePort(port: number): Promise<string> {
  return await new Promise<string>((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve("open");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      resolve(error.code ?? "error");
    });
  });
}

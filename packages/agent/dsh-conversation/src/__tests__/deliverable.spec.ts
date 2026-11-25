// 交付物域的**装配判据**（本包自己的整装，清单见 `./support/host.ts`）。
//
// 为什么要有这条：`/api/present.host` 这类路由是 `ctx.connection.fetch.register` 注册的 HTTP 路由，
// **不是 typert remote 方法**——漏装的表现是浏览器里 404，不是启动失败。
//
// 判据分三层：
// 1. `Connection` 的 `fetch` 面必须在（上游 `ui-deliverables` 的 `apply` 直接调它）；
// 2. **HTTP 宿主上真的有 `/api` 前缀**，且四条路由按 HTTP 的读数不是 404。这一层曾经整条缺失：
//    上游 `connection` 用 `ctx.inject(['webServer'], …)` 注册 `/api`，而 `webServer` 这个**上游服务名**
//    在我们的 store 里不存在（派生名 `web-server`）→ 回调永不执行 → 表在、没人服务，界面能渲染但交付物永远 404。
// 3. 两行都 `mount` 过；浏览器半只有一份实现、一处装配。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Connection, WebServer } from "@morlay/zephyr-app";
import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { DeliverablesHostDefault, WorkspaceChangesDefault } from "../index.ts";
import { mountDeliverablesHost } from "./support/deliverable-host.ts";

// 整装要几秒；全仓并发时 `testTimeout: 3000` 会误判成超时（单跑必绿）。
describe("交付物域", { timeout: 180_000 }, () => {
  test("两条行都 mount 过，`/api` 上四条路由被分派", async ({ appEnv }) => {
    const dataDir = appEnv.values.dataDir;
    const host = await mountDeliverablesHost(join(dataDir, "data"));
    // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
    appEnv.onCleanup(() => host.dispose());
    const app = host.app;

    // `fetch.register` 是那四条路由唯一的注册入口：它不在，`ui-deliverables` 的 `apply` 就炸。
    // `fetch` 不在 `Connection` 契约上（上游上传行按名字读 `ctx.connection.fetch`，路由注册在那里）。
    // 这条断言问的正是"运行期有没有它"，所以按运行期形状读，不做类型断言。
    const fetchFace: unknown = Reflect.get(app.get(Connection), "fetch");
    const register: unknown =
      typeof fetchFace === "object" && fetchFace !== null
        ? Reflect.get(fetchFace, "register")
        : undefined;
    expect(typeof register, "connection.fetch.register 缺了，交付物路由无处注册").toBe("function");

    // 两行都拿到了契约面（= `mount` 跑过）。
    expect(app.get(WorkspaceChangesDefault)).toBeDefined();
    expect(app.get(DeliverablesHostDefault)).toBeDefined();

    const web = app.get(WebServer) as {
      port: number;
      routesOf(): readonly { kind: string; path: string }[];
    };
    expect(
      web.routesOf().map((route) => route.kind + " " + route.path),
      "HTTP 宿主上没有 /api 前缀：那个前缀的注册没有执行",
    ).toContain("prefix /api");

    // 四条路由的 HTTP 读数：`present.host` 200；其余参数错也是 400（404 才是没注册）。
    const origin = "http://127.0.0.1:" + String(web.port);
    const readings = await Promise.all([
      fetch(origin + "/api/present.host"),
      fetch(origin + "/api/present.open"),
      fetch(origin + "/api/changes.summary"),
      fetch(origin + "/api/changes.diff"),
    ]);
    expect(
      readings.map((response) => new URL(response.url).pathname + " → " + String(response.status)),
      "四条交付物路由必须被分派（present.host 200，其余参数错 400；404 就是没注册）",
    ).toEqual([
      "/api/present.host → 200",
      "/api/present.open → 400",
      "/api/changes.summary → 400",
      "/api/changes.diff → 400",
    ]);
  });

  test("浏览器半：一份实现、一处装配", async () => {
    // 交付物**属会话域的一部分**（不是独立域）：实现包装上游 `ui-deliverables` 的 client 半，
    // 走 `fromCordis` 那条适配路径。
    const slots = await readFile(join(import.meta.dirname, "../ui/deliverable.slot.ts"), "utf8");
    expect(slots, "交付物行必须包装上游 UiDeliverablesPlugin").toContain("UiDeliverablesPlugin");
    expect(slots, "自持实现的标志就是 fromCordis").toContain("fromCordis");

    // 装配面显式装，且恰好一次。读的是 apps 的**清单实现文件**（`client/index.ts` 只是 barrel）——
    // 判的是装配面的**文本**，包内不 import apps 的任何东西。
    const assembly = await readFile(
      join(import.meta.dirname, "../../../../../apps/zephyr-custom/src/client/client.provide.ts"),
      "utf8",
    );
    const calls = assembly.match(/\.\.\.provideDeliverablesUi\(\)/g) ?? [];
    expect(calls, "装配面必须显式装交付物的行，且只有一处").toHaveLength(1);
  });
});

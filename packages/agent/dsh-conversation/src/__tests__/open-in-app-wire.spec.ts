// `open-in-app` 组的**载体判据**：这三条是 **HTTP 路由**（不是 `/api` 上的 remote 方法），
// 「打开方式」按钮读的就是 `GET /open-in-app/apps`——行不在，界面能渲染但按钮点开是空的。
//
// 路由 404 的产点是我们自己的 `WebServer.dispatch`（`web/web-server.service.ts`）：没有路由命中且没有
// fallback 时回 `Not Found`。所以判据就是「真 HTTP 的读数」，不经 `LocalRemote`（它只覆盖 handler 表）。
//
// 两个方向都在：装齐 → 200 + 应用清单；`without(OpenInAppHostRow)` → 404。
import { without } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr-app/testing";
import {
  OpenInAppHostRow,
  provideApiSession,
  provideSessionReference,
  provideSessionRemote,
} from "../server/index.ts";
import { mountConversationHost } from "./support/host.ts";

/** 一次读数：`GET /open-in-app/apps` 的状态与原文。 */
interface AppsReading {
  readonly status: number;
  readonly text: string;
}

/**
 * 真发一条 `GET /open-in-app/apps`（浏览器 `ui-open-in-app` 的那次 HTTP 读）。
 * @param origin - 宿主基址。
 * @returns HTTP 状态与应答原文。
 */
async function getApps(origin: string): Promise<AppsReading> {
  const response = await fetch(origin + "/open-in-app/apps");
  return { status: response.status, text: await response.text() };
}

describe("open-in-app 的 HTTP 路由", { timeout: 180_000 }, () => {
  test("`GET /open-in-app/apps` 在路由表上，回的是应用清单", async ({ appEnv }) => {
    const host = await mountConversationHost(appEnv.values.dataDir);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await getApps(host.origin);
    // 404 = 那三条路由没注册（行不在）；200 才说明「行装了 → 路由挂上了」。
    expect(status, "`/open-in-app/apps` 必须被注册（404 就是没注册）").toBe(200);
    const body = JSON.parse(text) as { apps?: unknown[] };
    expect(Array.isArray(body.apps), "应用清单的 `apps`").toBe(true);
  });

  test("剔掉 `OpenInAppHostRow` 后同一条请求是 404", async ({ appEnv }) => {
    // 端点面其余两段照装，只缺这一行（三条路由唯一的注册者）。
    const host = await mountConversationHost(appEnv.values.dataDir, "workspace-write", [
      ...provideSessionRemote(without(OpenInAppHostRow)),
      ...provideSessionReference(),
      ...provideApiSession(),
    ]);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await getApps(host.origin);
    // 这条是判据的**反方向**：行不在，路由就没人挂，线上就是用户看到的那个 404。
    expect(status, "缺 `OpenInAppHostRow` 时必须 404").toBe(404);
    expect(text.trim(), "404 的正文来自我们自己的 WebServer（没有 fallback 时就是 `Not Found`）").toBe("Not Found");
  });
});

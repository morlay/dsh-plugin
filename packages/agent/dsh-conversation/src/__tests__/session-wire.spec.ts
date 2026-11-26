// `session` 组的**载体判据**：端点注册了不等于线上可调——`/api` 上还得有人认领它。
//
// 404 的唯一产点在上游 `createSharedFetchHandler`（`vendor/deepseek-harness/packages/client/connection/src/rpc-host.ts`）：
// 既没有 exact Fetch 路由、`/api` 的拦截器 `matches(endpoint)` 又为假时它才回 `not found`。
// 本包 `api-session-host.spec.ts` / `main-flow.spec.ts` 都走 `LocalRemote`（直达路由表），按定义抓不到这一层。
//
// 两个方向都在：装齐 → 200 + 会话列表值；`without(ApiSessionControllerHost)` → 404。
import { randomUUID } from "node:crypto";
import { without } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr-app/testing";
import {
  ApiSessionControllerHost,
  provideApiSession,
  provideSessionReference,
  provideSessionRemote,
} from "../server/index.ts";
import { mountConversationHost } from "./support/host.ts";

/** `session/list` 的应答里本 spec 读到的两层（拦截器的结果面 ⊕ 上游回的值）。 */
interface ListEnvelope {
  readonly result?: {
    readonly ok?: boolean;
    readonly value?: { readonly items?: readonly unknown[] };
  };
}

/** 一次 wire 读数：状态与**原文**（404 时上游回的是 `not found` 文本，不是 JSON）。 */
interface WireReading {
  readonly status: number;
  readonly text: string;
}

/**
 * 真发一条 `session/list` 的 wire 请求（与浏览器 `createWebConnectionRpc` 同一信封）。
 * @param origin - 宿主基址。
 * @returns HTTP 状态与应答原文。
 */
async function postSessionList(origin: string): Promise<WireReading> {
  const response = await fetch(origin + "/api/session/list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: randomUUID(),
      method: "session/list",
      payload: { args: {} },
    }),
  });
  return { status: response.status, text: await response.text() };
}

describe("session 组的 wire 载体", { timeout: 180_000 }, () => {
  test("`POST /api/session/list` 被认领并回会话列表值", async ({ appEnv }) => {
    const host = await mountConversationHost(appEnv.values.dataDir);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await postSessionList(host.origin);
    // 404 = 没人认领（装配缺行 / descriptor 没登记）；200 才说明「注册 → 认领 → 分派」整条通。
    expect(status, "`/api/session/list` 必须被认领（404 就是没认领）").toBe(200);
    const body = JSON.parse(text) as ListEnvelope;
    expect(body.result?.ok, "拦截器的结果面").toBe(true);
    // 上游 `session/list` 回裸值（`RemoteResult` 只出现在客户端面 `faceOf` 那一层），所以只钉到 `items`。
    expect(Array.isArray(body.result?.value?.items), "会话列表里的 `items`").toBe(true);
  });

  test("剔掉 `ApiSessionControllerHost` 后同一条请求是 404", async ({ appEnv }) => {
    // 端点面其余两段照装，只缺这一行（它的 `onInit` 同时登记了 `session` 组的 descriptor）。
    const host = await mountConversationHost(appEnv.values.dataDir, "workspace-write", [
      ...provideSessionRemote(),
      ...provideSessionReference(),
      ...provideApiSession(without(ApiSessionControllerHost)),
    ]);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await postSessionList(host.origin);
    // 这条是判据的**反方向**：缺了端点行，认领随之消失，线上就是用户看到的那个 404。
    expect(status, "缺 `ApiSessionControllerHost` 时必须 404").toBe(404);
    expect(text.trim(), "404 的正文也钉住：`not found` 是没人认领，不是业务失败").toBe("not found");
  });
});

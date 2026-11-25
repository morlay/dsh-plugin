// `settings` 组的**载体判据**：端点注册了不等于线上可调——`/api` 上还得有人认领它。
//
// 404 的唯一产点在上游 `createSharedFetchHandler`（`vendor/deepseek-harness/packages/client/connection/src/rpc-host.ts`）：
// 既没有 exact Fetch 路由、`/api` 的拦截器 `matches(endpoint)` 又为假时，它直接回 `404 not found`。
// `RemoteHandlers.invoke` 与 `LocalRemote` 都绕过这一步（它们直达路由表），所以那两种判据绿着也可能线上 404。
//
// 两个方向都在：装齐 → 200 + 设置文档视图；`without(SettingEndpointDefault)` → 404（认领随行一起消失）。
import { randomUUID } from "node:crypto";
import { configure, without, type ProviderEntry } from "@morlay/zephyr";
import {
  AppEnvDefault,
  provideApiGateway,
  provideConnection,
  provideTypert,
  provideWeb,
} from "@morlay/zephyr-app";
import { describe, expect, mountFullApp, provideAppEnv, test } from "@morlay/zephyr-app/testing";
import { provideSetting } from "../server/index.ts";
import { SettingEndpointDefault } from "../server/setting-endpoint.service.ts";

/** `settings/describe` 的应答里本 spec 读到的两层（拦截器的结果面 ⊕ 端点的 `RemoteResultWire`）。 */
interface DescribeEnvelope {
  readonly result?: {
    readonly ok?: boolean;
    readonly value?: {
      readonly ok?: boolean;
      readonly value?: {
        readonly writable?: boolean;
        readonly namespaces?: readonly { readonly ns?: string }[];
      };
    };
  };
}

/**
 * 起一棵「只剩 settings 这一组」的宿主：wire 载体 + 被测域。
 * @param dataDir - 本用例的临时数据根。
 * @param settingsRows - settings 域的条目（装齐或剔掉端点行）。
 * @returns 起好的行树（`origin` 就是真 HTTP 地址）。
 */
async function mountHost(dataDir: string, settingsRows: readonly ProviderEntry[]) {
  return await mountFullApp({
    dataDir,
    // 端口用 0（内核分配）：固定端口会撞上本地正在跑的宿主，那是误判的来源。
    port: 0,
    providers: [
      ...provideWeb(),
      ...provideAppEnv(configure(AppEnvDefault, { profileDir: process.cwd(), dataDir })),
      ...provideConnection(),
      ...provideTypert(),
      ...provideApiGateway(),
      ...settingsRows,
    ],
    timeoutMs: 120_000,
  });
}

/** 一次 wire 读数：状态与**原文**（404 时上游回的是 `not found` 文本，不是 JSON）。 */
interface WireReading {
  readonly status: number;
  readonly text: string;
}

/**
 * 真发一条 `settings/describe` 的 wire 请求（与浏览器 `createWebConnectionRpc` 同一信封）。
 * @param origin - 宿主基址。
 * @returns HTTP 状态与应答原文。
 */
async function postSettingsDescribe(origin: string): Promise<WireReading> {
  const response = await fetch(origin + "/api/settings/describe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: randomUUID(),
      method: "settings/describe",
      payload: { args: {} },
    }),
  });
  return { status: response.status, text: await response.text() };
}

describe("settings 组的 wire 载体", { timeout: 180_000 }, () => {
  test("`POST /api/settings/describe` 被认领并回设置文档视图", async ({ appEnv }) => {
    const host = await mountHost(appEnv.values.dataDir, [...provideSetting()]);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await postSettingsDescribe(host.origin);
    // 404 = 没人认领（装配缺行 / 桥没装）；200 才说明「注册 → 认领 → 分派」整条通。
    expect(status, "`/api/settings/describe` 必须被认领（404 就是没认领）").toBe(200);
    const body = JSON.parse(text) as DescribeEnvelope;
    expect(body.result?.ok, "拦截器的结果面").toBe(true);
    expect(body.result?.value?.ok, "端点的 `RemoteResultWire`").toBe(true);

    const view = body.result?.value?.value;
    expect(typeof view?.writable, "视图里的 `writable`").toBe("boolean");
    expect(Array.isArray(view?.namespaces), "视图里的 `namespaces`").toBe(true);
  });

  test("剔掉 `SettingEndpointDefault` 后同一条请求是 404", async ({ appEnv }) => {
    const host = await mountHost(appEnv.values.dataDir, [
      ...provideSetting(without(SettingEndpointDefault)),
    ]);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await postSettingsDescribe(host.origin);
    // 这条是判据的**反方向**：缺了端点行，认领随之消失，线上就是用户看到的那个 404。
    expect(status, "缺 `SettingEndpointDefault` 时必须 404（否则这条判据抓不到缺行）").toBe(404);
    expect(text.trim(), "404 的正文也钉住：`not found` 是没人认领，不是业务失败").toBe("not found");
  });
});

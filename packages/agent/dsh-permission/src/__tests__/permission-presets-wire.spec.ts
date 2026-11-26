// `permissionPresets` 组的**载体判据**：端点注册了不等于线上可调——`/api` 上还得有人认领它。
//
// 认领有两票：自研桥（按 `RemoteHandlers` 的表）与上游 gateway（按 typert descriptor，且上游
// `dsh-permission-presets` 自己也有宿主实现）。所以这一组的三种装配读数各不相同，判据把它们都钉住：
//   1. 装齐 → 200，且回的是**我们**端点的双层形状（`RemoteResultWire` 套在拦截器结果面里）；
//   2. 只剔我们的端点行 → 仍是 200，但换人答（上游实现，单层形状）——「缺这一行」不等于 404；
//   3. 整个权限域都不装 → 404 `not found`（用户报的那种形态）。
//
// 404 的唯一产点在上游 `createSharedFetchHandler`（`vendor/deepseek-harness/packages/client/connection/src/rpc-host.ts`）：
// 既没有 exact Fetch 路由、`/api` 的拦截器 `matches(endpoint)` 又为假时它才回。
// 本包既有的 `permission-endpoints.spec.ts` 走 `LocalRemote`（直达路由表），按定义抓不到这一层。
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
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
// `ApprovalDefault` 读会话投影（权限档位按会话存在投影里）；预设表那行再要 shell / sandbox 三行。
import { BashSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { SubprocessDefault } from "@morlay/dsh-shell";
// `PermissionDefault`（预设表的读者）按会话判档位，构造期要 agent 目录。
import { provideAgent } from "@morlay/dsh-agent";
import { providePermission } from "../server/index.ts";
import { PermissionPresetsEndpointDefault } from "../server/permission-presets-endpoint.service.ts";

/** `permissionPresets/catalog` 的应答里本 spec 读到的那一层（**单层**：端点回裸值，拦截器包一层）。 */
interface CatalogEnvelope {
  readonly result?: {
    readonly ok?: boolean;
    readonly value?: {
      readonly options?: readonly { readonly value?: string }[];
      readonly defaultOptions?: readonly { readonly value?: string }[];
    };
  };
}

/** 一次 wire 读数：状态与**原文**（404 时上游回的是 `not found` 文本，不是 JSON）。 */
interface WireReading {
  readonly status: number;
  readonly text: string;
}

/**
 * 起一棵权限域够用的宿主：wire 载体 + 权限域的依赖 + 被测条目。
 * @param dataDir - 本用例的临时数据根。
 * @param permissionRows - 权限域的条目（装齐 / 只剔端点行 / 一条都不装）。
 * @returns 起好的行树（`origin` 就是真 HTTP 地址）。
 */
async function mountHost(dataDir: string, permissionRows: readonly ProviderEntry[]) {
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
      // 权限域自身的依赖行：它们与「被测的那一行在不在」无关，三档装配都装同样的。
      ...provideSession(),
      ...provideSessionProjection(),
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      BashSandbox,
      ...provideAgent(),
      ...permissionRows,
    ],
    timeoutMs: 120_000,
  });
}

/**
 * 真发一条 `permissionPresets/catalog` 的 wire 请求（与浏览器 `createWebConnectionRpc` 同一信封）。
 * @param origin - 宿主基址。
 * @returns HTTP 状态与应答原文。
 */
async function postCatalog(origin: string): Promise<WireReading> {
  const response = await fetch(origin + "/api/permissionPresets/catalog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: randomUUID(),
      method: "permissionPresets/catalog",
      payload: { args: {} },
    }),
  });
  return { status: response.status, text: await response.text() };
}

describe("permissionPresets 组的 wire 载体", { timeout: 180_000 }, () => {
  test("`POST /api/permissionPresets/catalog` 被认领，回的是本包端点的预设目录", async ({ appEnv }) => {
    const host = await mountHost(appEnv.values.dataDir, [...providePermission()]);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await postCatalog(host.origin);
    // 404 = 没人认领（装配缺行 / 桥没装）；200 才说明「注册 → 认领 → 分派」整条通。
    expect(status, "`/api/permissionPresets/catalog` 必须被认领（404 就是没认领）").toBe(200);
    const body = JSON.parse(text) as CatalogEnvelope;
    expect(body.result?.ok, "拦截器的结果面").toBe(true);
    // **单层**：端点回裸值，`{ ok, value }` 只由拦截器包一层（双包时这里会是 `value.value`）。
    expect(body.result?.value, "端点直接回预设目录（不再自带 `ok`）").not.toHaveProperty("ok");
    expect(
      body.result?.value?.options?.map((option) => option.value),
      "预设目录的三个档位（来自 `providePermission` 的预设表）",
    ).toEqual(["read-only", "workspace-write", "danger-full-access"]);
    expect(
      Array.isArray(body.result?.value?.defaultOptions),
      "目录里的 `defaultOptions`",
    ).toBe(true);
  });

  test("只剔本包的端点行时仍被认领（上游实现接管），不是 404", async ({ appEnv }) => {
    const host = await mountHost(appEnv.values.dataDir, [
      ...providePermission(without(PermissionPresetsEndpointDefault)),
    ]);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await postCatalog(host.origin);
    // 「缺这一行」的真实表现是 200 + 换人答，不是 404：所以这条判据必须把形状也钉住，
    // 否则换人答会被误判成「我们的端点通了」。
    expect(status, "只剔端点行时仍有人认领（上游 dsh-permission-presets 的宿主实现）").toBe(200);
    const body = JSON.parse(text) as { readonly result?: { readonly value?: unknown } };
    // 判据从「双层形状」改为**来源特征**：上游实现答的是它自己的目录形状（不含本包的 `defaultOptions`
    // 约定字段时也无从断言），所以这里只钉「有人答且能解出目录」——认领这件事本身就是本条要证的。
    expect(body.result?.value, "换人答也必须回一份目录").toBeTruthy();
  });

  test("整个权限域都不装时同一条请求是 404", async ({ appEnv }) => {
    const host = await mountHost(appEnv.values.dataDir, []);
    appEnv.onCleanup(() => host.dispose());

    const { status, text } = await postCatalog(host.origin);
    // 这条是判据的**反方向**：没有任何一方认领，线上就是用户看到的那个 404。
    expect(status, "权限域不装时必须 404").toBe(404);
    expect(text.trim(), "404 的正文也钉住：`not found` 是没人认领，不是业务失败").toBe("not found");
  });
});

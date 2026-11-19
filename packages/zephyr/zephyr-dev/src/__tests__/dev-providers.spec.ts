// `devProviders(mode)` 的**唯一判据**：`Federation.dev.include`（哪些包当文件走 vite）。
//
// 为什么只判这一条：dev 行清单里其余条目都是「装哪些行」，与形态无关；形态只影响这一份名单。
// 打包形态清空 = 全部预编译（页面仍是 vite 出的，只是没有逐文件包）；其余形态 `@morlay/*` 走 vite。
import type { ProviderEntry } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import { devProviders } from "../dev/provide.ts";
import { FederationDefault } from "../federation/federation.service.ts";
import { ServerHmr } from "../internal/server-hmr.ts";
import { ViteClientAssets } from "../client-assets/vite-client-assets.service.ts";
import { ServeDefault } from "../http/serve.service.ts";

/**
 * 条目背后的实现类（`{ provide }` 或裸类；本用例的清单里没有 cordis 插件条目）。
 * @param entry - 清单条目。
 * @returns 实现类。
 */
function implOf(entry: ProviderEntry): unknown {
  return typeof entry === "function" ? entry : (entry as { provide: unknown }).provide;
}

/**
 * 从清单里取出 dev 行的名单（`configure` 之后 `FederationDefault` 那条仍带 config）。
 * @param mode - `devProviders` 的形态。
 * @returns `dev.include`。
 */
function includeOf(mode: Parameters<typeof devProviders>[0]): readonly string[] {
  const entry = devProviders(mode).find(
    (item: ProviderEntry) => implOf(item) === FederationDefault,
  );
  const config = (entry as { config?: { dev?: { include?: readonly string[] } } } | undefined)
    ?.config;
  expect(config, "清单里必须有 FederationDefault 这一条（dev 的预构建范围归它）").toBeDefined();
  return config?.dev?.include ?? [];
}

describe("devProviders", () => {
  it("打包形态：名单清空（全部预编译）", () => {
    expect(includeOf({ packaged: true })).toEqual([]);
  });

  it("非打包形态：`@morlay/*` 当文件走 vite（改它们靠 HMR）", () => {
    expect(includeOf({ packaged: false })).toEqual(["@morlay/*"]);
  });

  it("缺省等于非打包（调用方不必写 `{ packaged: false }`）", () => {
    expect(includeOf(undefined)).toEqual(["@morlay/*"]);
  });

  it("行清单：vite 旁路 + 联邦 + 页面兜底 + 换树时机，一条不少", () => {
    const classes = devProviders().map((item: ProviderEntry) => implOf(item));
    // 页面兜底与其 dev 实现（`ClientAssets` 的必需前置）：顺序在 `assertOrder` 里另判。
    expect(classes).toContain(ViteClientAssets);
    expect(classes).toContain(ServeDefault);
    // 换树时机：`DevHmr` 的实现（打包形态也要，源码变更仍要重载）。
    expect(classes).toContain(ServerHmr);
    expect(
      classes.indexOf(ViteClientAssets) < classes.indexOf(ServeDefault),
      "实现要排在消费者之前",
    ).toBe(true);
  });
});

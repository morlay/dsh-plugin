// `devProviders(mode)` 的两条判据：**形态**（`Federation.dev.include`：哪些包当文件走 vite）与
// **HMR 的两半开关**（装不装换树行、vite 旁路挂不挂客户端热更）。
//
// 形态只影响那一份名单：打包形态清空 = 全部预编译（页面仍是 vite 出的，只是没有逐文件包）；
// 其余形态 `@morlay/*` 走 vite。两半开关只影响「装哪些行 / 带哪个 config」，不改名单。
import type { ProviderEntry } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import { devProviders } from "../dev/provide.ts";
import { FederationDefault } from "../federation/federation.service.ts";
import { ServerHmr } from "../internal/server-hmr.ts";
import { ViteClientAssets } from "../client-assets/vite-client-assets.service.ts";
import { ViteHandoffDefault } from "../vite-handoff/vite-handoff.service.ts";
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
 * 清单里某个实现的条目（`configure` 之后仍带 config）。
 * @param mode - `devProviders` 的形态。
 * @param impl - 实现类。
 * @returns 条目，或 `undefined`（没装）。
 */
function entryOf(mode: Parameters<typeof devProviders>[0], impl: unknown): unknown {
  return devProviders(mode).find((item: ProviderEntry) => implOf(item) === impl);
}

/** 条目上的 `hmr` 配置（没配就是 `undefined`）。 */
function hmrConfigOf(entry: unknown): boolean | undefined {
  return (entry as { config?: { hmr?: boolean } } | undefined)?.config?.hmr;
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

  it("服务端 HMR 关掉：清单里没有换树行（`DevHmr` 没人提供，CLI 的 `tryGet` 就是空）", () => {
    const classes = devProviders({ hmr: { server: false } }).map((item: ProviderEntry) =>
      implOf(item),
    );
    expect(classes, "换树行不再装配").not.toContain(ServerHmr);
    // 客户端那半不受影响：页面仍由 vite 出。
    expect(classes).toContain(ViteClientAssets);
  });

  it("客户端 HMR 关掉：vite 旁路带 `hmr: false`（不建 ws、页面不注入客户端）", () => {
    expect(hmrConfigOf(entryOf({ hmr: { client: false } }, ViteHandoffDefault))).toBe(false);
  });

  it("两半都关：换树行不在，vite 旁路仍开着「`hmr: false`」", () => {
    const mode = { hmr: { client: false, server: false } } as const;
    const classes = devProviders(mode).map((item: ProviderEntry) => implOf(item));
    expect(classes).not.toContain(ServerHmr);
    expect(hmrConfigOf(entryOf(mode, ViteHandoffDefault))).toBe(false);
  });

  it("缺省：两半都开（vite 旁路不带 `hmr` 补丁，换树行在）", () => {
    expect(hmrConfigOf(entryOf(undefined, ViteHandoffDefault))).toBeUndefined();
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

import { describe, expect, it } from "vitest";
import { CliError, layoutOf } from "@morlay/zephyr-cli";
import type { ResolvedConfig } from "@morlay/zephyr-cli";
import { electronBuilderConfigOf } from "../electron-builder.ts";

/**
 * 造一份带 desktop 段的解析结果。
 * @param withDesktop - 是否带 desktop 段。
 * @returns 解析结果。
 */
function resolvedFor(withDesktop = true): ResolvedConfig {
  const workspace = "/w";
  const layout = layoutOf(workspace, undefined, "Demo");
  return {
    config: {
      server: { entry: "./src/server.ts" },
      client: { entry: "./src/client/index.tsx" },
      ...(withDesktop ? { desktop: { id: "ai.example.demo", name: "Demo" } } : {}),
    },
    configFile: "/w/zephyr.config.ts",
    workspace,
    layout,
    serverEntry: "/w/src/server.ts",
    clientEntry: "/w/src/client/index.tsx",
    appName: "Demo",
    hmr: { client: true, server: true },
  };
}

describe("electron-builder 配置推导", () => {
  it("身份取 desktop 段，产物落在 node_modules/.zephyr/app", () => {
    const resolved = resolvedFor();
    const config = electronBuilderConfigOf({
      resolved,
      layout: resolved.layout,
      electronVersion: "45.2.3",
    });
    expect(config.appId).toBe("ai.example.demo");
    expect(config.productName).toBe("Demo");
    expect(config.directories.output).toBe("/w/target/Demo/app");
  });

  it("asar 打开，native 拆出去；宿主那一份不在这里（PackagerDefault 复制到 Resources/runtime）", () => {
    const resolved = resolvedFor();
    const config = electronBuilderConfigOf({
      resolved,
      layout: resolved.layout,
      electronVersion: "45.2.3",
    });
    expect(config.asar).toBe(true);
    // 不签名是配置事实：换台机器、换个钥匙串都不该改变这个行为。
    expect(config.mac.identity).toBeNull();
    expect(config.asarUnpack).toEqual(["**/*.node"]);
    // 宿主的那一份（`bootstrap.mjs` / `client_modules/` / 闭包）不进 electron-builder 的清单：
    // 打包之后由 `PackagerDefault` 整份复制到 `Resources/runtime`——它是自包含的一份应用。
    expect(config.extraResources).toEqual([
      { from: "/w/target/Demo/desktop.json", to: "desktop.json" },
    ]);
  });

  it("没有 desktop 段就报错，并说清缺哪一段", () => {
    const resolved = resolvedFor(false);
    expect(() =>
      electronBuilderConfigOf({ resolved, layout: resolved.layout, electronVersion: "45.2.3" }),
    ).toThrowError(CliError);
    expect(() =>
      electronBuilderConfigOf({ resolved, layout: resolved.layout, electronVersion: "45.2.3" }),
    ).toThrowError(/desktop 段/u);
  });
});

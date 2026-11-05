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
  const layout = layoutOf(workspace);
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
    expect(config.directories.output).toBe("/w/node_modules/.zephyr/app");
  });

  it("asar 打开，native 拆出去；静态面与闭包放在 asar 外的 Resources", () => {
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
    // 闭包在 asar 里（`files: profile/**`），extraResources 只剩静态面与身份。
    expect(config.extraResources).toEqual([
      { from: "/w/node_modules/.zephyr/dist", to: "dist" },
      { from: "/w/node_modules/.zephyr/desktop.json", to: "desktop.json" },
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

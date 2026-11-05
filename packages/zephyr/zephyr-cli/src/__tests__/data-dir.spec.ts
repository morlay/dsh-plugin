import { describe, expect, it } from "vitest";
import { resolveDataDir } from "../data-dir.ts";

describe("数据目录三态", () => {
  it("workspace 落在装配根下的 .dsh-store", () => {
    expect(resolveDataDir({ spec: "workspace", profileDir: "/w", appName: "App" })).toBe(
      "/w/.dsh-store",
    );
  });

  it("xdg 跟着平台走", () => {
    expect(
      resolveDataDir({
        spec: "xdg",
        profileDir: "/w",
        appName: "App",
        platform: "darwin",
        homeDir: "/Users/me",
      }),
    ).toBe("/Users/me/Library/Application Support/App");
    // linux 的 xdg 目录允许被 XDG_CONFIG_HOME 覆盖（机器上的环境可能已经设了），所以只断言落点。
    expect(
      resolveDataDir({
        spec: "xdg",
        profileDir: "/w",
        appName: "App",
        platform: "linux",
        homeDir: "/home/me",
      }).endsWith("/App"),
    ).toBe(true);
  });

  it("绝对路径原样，相对路径按装配根解析", () => {
    expect(resolveDataDir({ spec: "/tmp/store", profileDir: "/w", appName: "App" })).toBe(
      "/tmp/store",
    );
    expect(resolveDataDir({ spec: "store", profileDir: "/w", appName: "App" })).toBe("/w/store");
  });
});

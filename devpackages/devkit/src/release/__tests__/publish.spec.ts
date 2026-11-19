import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGISTRY,
  distTagOf,
  isLocalRegistry,
  registryOf,
  registryOverride,
} from "../publish.ts";

describe("distTagOf", () => {
  it("稳定版落 latest", () => {
    expect(distTagOf("0.2.0")).toBe("latest");
  });

  it("alpha 预发布落 alpha", () => {
    expect(distTagOf("0.2.0-alpha.0")).toBe("alpha");
    expect(distTagOf("0.2.0-alpha.3")).toBe("alpha");
  });

  it("其余预发布落 next", () => {
    expect(distTagOf("0.2.2-rc.3")).toBe("next");
    expect(distTagOf("0.2.0-beta.1")).toBe("next");
  });
});

describe("registryOf", () => {
  it("不给 --registry 就落本地模拟 registry", () => {
    expect(registryOf([])).toBe(DEFAULT_REGISTRY);
    expect(registryOf(["--dry-run"])).toBe(DEFAULT_REGISTRY);
  });

  it("给了 --registry 用给的地址", () => {
    expect(registryOf(["--registry", "https://registry.npmjs.org/", "--dry-run"])).toBe(
      "https://registry.npmjs.org/",
    );
  });
});

describe("isLocalRegistry", () => {
  it("loopback 算本地", () => {
    expect(isLocalRegistry("http://127.0.0.1:7677/")).toBe(true);
    expect(isLocalRegistry("http://localhost:7677")).toBe(true);
  });

  it("真 registry 不算本地", () => {
    expect(isLocalRegistry("https://registry.npmjs.org/")).toBe(false);
    expect(isLocalRegistry("https://npm.pkg.github.com/")).toBe(false);
  });

  it("不是 URL 也不算本地", () => {
    expect(isLocalRegistry("not a url")).toBe(false);
  });
});

describe("registryOverride", () => {
  it("scoped 包用 --config.<scope>:registry 覆盖（--registry 打不过 scope 映射）", () => {
    expect(registryOverride("@morlay/session-mode", "https://registry.npmjs.org/")).toEqual([
      "--config.@morlay:registry=https://registry.npmjs.org/",
    ]);
  });

  it("无 scope 的包不需要覆盖", () => {
    expect(registryOverride("left-pad", "http://127.0.0.1:7677/")).toEqual([]);
  });
});

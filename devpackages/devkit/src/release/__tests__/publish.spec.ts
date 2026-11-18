import { describe, expect, it } from "vitest";
import { distTagOf } from "../publish.ts";

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

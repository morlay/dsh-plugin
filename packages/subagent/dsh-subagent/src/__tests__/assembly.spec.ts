import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();

let patch: string;
let app: Record<string, unknown>;

beforeAll(async () => {
  patch = await readFile(join(ROOT, "packages/subagent/dsh-subagent/cordis.patch.yml"), "utf8");
  app = JSON.parse(
    await readFile(join(ROOT, "apps/dsh-custom-next/package.json"), "utf8"),
  ) as Record<string, unknown>;
});

/** 装配面守护：上游那一行确实被我们停掉，替代行确实被插上，app 的 bundle 列表确实引用本包。 */
describe("装配面", () => {
  it("禁用上游 subagent 行", () => {
    expect(patch).toContain("- id: subagent\n  disabled: true");
  });

  it("按上游同形的要求插入本包行（无 config）", () => {
    expect(patch).toContain("- insert:");
    expect(patch).toContain('name: "@morlay/dsh-subagent"');
  });

  it("app 的 profile bundles 引用本包，且声明了依赖", () => {
    const dsh = app.dsh as { profile: { bundles: string[] } };
    const dependencies = app.dependencies as Record<string, string>;

    expect(dsh.profile.bundles).toContain("@morlay/dsh-subagent");
    expect(dependencies["@morlay/dsh-subagent"]).toBe("workspace:*");
  });
});

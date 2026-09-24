import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();

let patch: string;
let app: Record<string, unknown>;
let manifest: Record<string, unknown>;

beforeAll(async () => {
  patch = await readFile(join(ROOT, "packages/subagent/dsh-subagent/cordis.patch.yml"), "utf8");
  app = JSON.parse(
    await readFile(join(ROOT, "apps/dsh-custom-next/package.json"), "utf8"),
  ) as Record<string, unknown>;
  manifest = JSON.parse(
    await readFile(join(ROOT, "packages/subagent/dsh-subagent/package.json"), "utf8"),
  ) as Record<string, unknown>;
});

/** 装配面守护：上游那一行确实被我们停掉，替代行确实被插上，app 的 bundle 列表确实引用本包。 */
describe("装配面", () => {
  it("禁用上游 subagent 行", () => {
    expect(patch).toContain("- id: subagent\n  disabled: true");
  });

  it("禁用官方设置卡与它带的模型白名单服务行", () => {
    expect(patch).toContain("- id: ui-settings-subagent\n  disabled: true");
    expect(patch).toContain("- id: subagent-model-selection-settings\n  disabled: true");
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

/**
 * 配置页：页面由 `@morlay/dsh-client-ui-schema-form` 按 volatile 字段自动生成（本包 host 的 Config 与上游逐行
 * 一致，说明写不进 schema），本包自己的 client 半只给那两个字段补文案——经字段槽
 * `settings.schema-form.field` 认领，host 一行都不动。
 */
describe("配置页", () => {
  it("client 半声明 web 面与它要的行，出口与 publishConfig 都对上", () => {
    const exports = manifest.exports as Record<string, unknown>;
    const publishConfig = manifest.publishConfig as { exports: Record<string, unknown> };
    const dsh = manifest.dsh as { client?: { platform?: string; inject?: string[] } };

    expect(exports["./client"]).toEqual({
      types: "./src/client/index.ts",
      default: "./dist/client.cjs",
    });
    expect(publishConfig.exports["./client"]).toEqual({
      types: "./dist/client.d.cts",
      default: "./dist/client.cjs",
    });
    expect(dsh.client?.platform).toBe("web");
    expect(dsh.client?.inject).toEqual([
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-slots",
      "@morlay/dsh-client-ui-schema-form",
    ]);
  });

  it("限额字段声明为 volatile：这是自动生成配置页的前提", async () => {
    const source = await readFile(
      join(ROOT, "packages/subagent/dsh-subagent/src/index.ts"),
      "utf8",
    );

    expect(source).toContain(".default(1).volatile()");
    expect(source).toContain(".default(8).volatile()");
  });
});

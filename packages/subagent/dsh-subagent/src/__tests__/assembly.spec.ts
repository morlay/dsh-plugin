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
 * client 面：设置卡在浏览器半，roster 只认「包声明了 `dsh.client` + 有 `./client` 入口」这两条，
 * 所以这里盯的就是这两条（roster 的收集不在本包测）。
 */
describe("client 面", () => {
  it("exports 与 publishConfig 都给了 ./client 入口", () => {
    const exports = manifest.exports as Record<string, unknown>;

    expect(exports["./client"]).toEqual({
      types: "./src/client/index.ts",
      default: "./dist/client.cjs",
    });

    const publishConfig = manifest.publishConfig as { exports: Record<string, unknown> };

    expect(publishConfig.exports["./client"]).toEqual({
      types: "./dist/client.d.cts",
      default: "./dist/client.cjs",
    });
  });

  it("dsh.client 声明 web 面与它要的 client 插件行", () => {
    const dsh = manifest.dsh as { client?: { platform?: string; inject?: string[] } };

    expect(dsh.client?.platform).toBe("web");
    expect(dsh.client?.inject).toEqual([
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-plugin-manager",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-slots",
      "@morlay/dsh-client-ui-primitives",
    ]);
  });

  it("卡片读本包行 id 那个 namespace（settings 的 namespace 名就是行 id）", async () => {
    const source = await readFile(
      join(ROOT, "packages/subagent/dsh-subagent/src/client/subagent-limits-card-controller.ts"),
      "utf8",
    );

    expect(source).toContain('export const SUBAGENT_NS = "subagent-fork";');
  });
  it("client 半注册到本行的配置入口（`plugins.row.config`），不占官方分组", async () => {
    const source = await readFile(
      join(ROOT, "packages/subagent/dsh-subagent/src/client/index.ts"),
      "utf8",
    );

    // 官方分组 `plugins.item` 由官方那几张设置卡占用；行自己的配置挂在行上。
    expect(source).toContain('"plugins.row.config"');
    expect(source).not.toContain('"plugins.item"');
    // key 与页面 `rowConfigKey(bundle, rowId)` 同拼法：bundle = 本包名，行 id = patch 里插的 `subagent-fork`。
    expect(source).toContain('export const SUBAGENT_ROW_CONFIG_KEY = "@morlay/dsh-subagent#subagent-fork";');
  });
});

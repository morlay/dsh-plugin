import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();

let app: Record<string, unknown>;
let manifest: Record<string, unknown>;

beforeAll(async () => {
  app = JSON.parse(
    await readFile(join(ROOT, "apps/dsh-custom-next/package.json"), "utf8"),
  ) as Record<string, unknown>;
  manifest = JSON.parse(
    await readFile(join(ROOT, "packages/subagent/dsh-subagent/package.json"), "utf8"),
  ) as Record<string, unknown>;
});

/** 装配面守护：上游那一行确实被我们停掉，替代行确实被插上，app 的 bundle 列表确实引用本包。 */
describe("装配面", () => {
  it("装配入口是 session-mode-profile：app 列的是它，它依赖本包", async () => {
    const dsh = app.dsh as { profile: { bundles: string[] } };
    const bundle = JSON.parse(
      await readFile(join(ROOT, "packages/bundles/session-mode-profile/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(dsh.profile.bundles).toContain("@morlay/session-mode-profile");
    expect(bundle.dependencies["@morlay/dsh-subagent"]).toBe("workspace:*");
  });
});

/**
 * 配置页：**官方那张卡片**承担（接管按官方行 id 复用，`subagent` namespace 与卡片行都在），本包不再有 client 半
 * ——曾用来替代卡片的字段文案槽随之退场（两套都注册 `settings.subagent` 字典会撞：
 * `locale.register` 对同 namespace 同 locale 直接抛错）。
 */
describe("配置页", () => {
  it("本包不再发布 client 面：出口、注入声明与那条依赖都清掉了", () => {
    const exports = manifest.exports as Record<string, unknown>;
    const publishConfig = manifest.publishConfig as { exports: Record<string, unknown> };

    expect(exports["./client"]).toBeUndefined();
    expect(publishConfig.exports["./client"]).toBeUndefined();
    expect(manifest.dsh).toBeUndefined();
    for (const section of ["devDependencies", "peerDependencies"] as const) {
      const dependencies = manifest[section] as Record<string, string>;
      expect(dependencies["@deepseek-ai/dsh-client-locale"]).toBeUndefined();
      expect(dependencies["@deepseek-ai/dsh-client-ui-slots"]).toBeUndefined();
      expect(dependencies["@morlay/dsh-client-ui-primitives"]).toBeUndefined();
    }
  });

  it("限额字段声明为 volatile：官方卡片可编辑它们的前提", async () => {
    const source = await readFile(
      join(ROOT, "packages/subagent/dsh-subagent/src/index.ts"),
      "utf8",
    );

    expect(source).toContain(".default(1).volatile()");
    expect(source).toContain(".default(8).volatile()");
  });
});

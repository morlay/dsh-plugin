// `configure` 的配置必须真的到达实例：`values` 与三个派生路径都在 `AppEnvDefault` 的构造里定，
// zephyr 走 `new impl(config)`（`@morlay/zephyr` 的 `attach.construct`）。
//
// 这条守卫存在的原因：配置曾写成类字段初值，装配面的覆盖被静默丢弃，`dataDir` 落在进程 cwd 的
// `.dsh-store`，多个 spec 把会话写进仓库根并跨运行残留——类型不报错，只有行为错。
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { AppEnv } from "../app-env/app-env.contract.ts";
import { afterEach, describe, expect, it } from "vitest";
import { AppEnvDefault } from "../app-env/app-env.service.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

describe("AppEnvDefault：装配面的配置真的生效", () => {
  it("`profileDir` / `dataDir` 覆盖进 `values`，三个派生路径跟着走", async () => {
    const app = await bootstrapApplication({
      providers: [
        ...configure(AppEnvDefault, {
          profileDir: "/profile",
          dataDir: "/profile/storages",
          dev: false,
          aggregate: ["@deepseek-ai/*"],
        })([AppEnvDefault]),
      ],
      timeoutMs: 10_000,
    });
    opened.push(app);

    const env = app.get(AppEnv);
    expect(env.values).toMatchObject({
      profileDir: "/profile",
      dataDir: "/profile/storages",
      dev: false,
      aggregate: ["@deepseek-ai/*"],
    });
    expect(env.appBootDir).toBe("/profile/src/client");
    expect(env.profileManifest).toBe("/profile/package.json");
    expect(env.cacheDir).toBe("/profile/node_modules/.dsh-client-modules");
  });

  it("不给配置时用默认值（`profileDir` = cwd，`dev` = true）", async () => {
    const app = await bootstrapApplication({ providers: [AppEnvDefault], timeoutMs: 10_000 });
    opened.push(app);

    const env = app.get(AppEnv);
    expect(env.values.profileDir).toBe(process.cwd());
    expect(env.values.dev).toBe(true);
  });
});

// `configure` 的配置必须真的到达实例：`values` 与三个派生路径都在 `AppEnvDefault` 的构造里定，
// zephyr 走 `new impl(config)`（`@morlay/zephyr` 的 `attach.construct`）。
//
// 这条守卫存在的原因：配置曾写成类字段初值，装配面的覆盖被静默丢弃，`dataDir` 落在进程 cwd 的
// `.dsh-store`，多个 spec 把会话写进仓库根并跨运行残留——类型不报错，只有行为错。
import { bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { AppEnv } from "../app-env/app-env.contract.ts";
import { afterEach, describe, expect, it } from "vitest";
import { AppEnvDefault } from "../app-env/app-env.service.ts";
import { provideAppEnv } from "../app-env/provide.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

describe("AppEnvDefault：装配面的配置真的生效", () => {
  it("`profileDir` / `dataDir` 覆盖进 `values`，三个派生路径跟着走", async () => {
    const app = await bootstrapApplication({
      providers: [
        ...provideAppEnv(
          configure(AppEnvDefault, {
            profileDir: "/profile",
            dataDir: "/profile/storages",
          }),
        ),
      ],
      timeoutMs: 10_000,
    });
    opened.push(app);

    const env = app.get(AppEnv);
    expect(env.values).toMatchObject({
      profileDir: "/profile",
      dataDir: "/profile/storages",
    });
    expect(env.appBootDir).toBe("/profile/src/client");
    expect(env.profileManifest).toBe("/profile/package.json");
    // 运行 cache 落在数据根下（`{DSH_HOME}/cache`），不跟着装配面走。
    expect(env.cacheDir).toBe("/profile/storages/cache");
  });

  it("AppEnv 只管路径：不给配置时 `profileDir` = cwd", async () => {
    const app = await bootstrapApplication({ providers: [...provideAppEnv()], timeoutMs: 10_000 });
    opened.push(app);

    const env = app.get(AppEnv);
    expect(env.values.profileDir).toBe(process.cwd());
  });
});

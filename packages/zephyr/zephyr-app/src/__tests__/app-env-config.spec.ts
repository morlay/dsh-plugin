// `configure` 的配置必须真的到达实例：`values` 与三个派生路径都在 `AppEnvDefault` 的构造里定，
// zephyr 走 `new impl(config)`（`@morlay/zephyr` 的 `attach.construct`）。
//
// 这条守卫存在的原因：配置曾写成类字段初值，装配面的覆盖被静默丢弃，`dataDir` 落在进程 cwd 的
// `.dsh-store`，多个 spec 把会话写进仓库根并跨运行残留——类型不报错，只有行为错。
import { Injectable, bootstrapApplication, configure, type App } from "@morlay/zephyr";
import { join } from "node:path";
import { AppEnv, type AppEnvValues } from "../app-env/app-env.contract.ts";
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

  it("`defaultWorkingDirectory` 不给就用 cwd，给了就用给的值", async () => {
    // 缺省：与 `profileDir` 同一个兜底（cwd），但它是**另一个**部署值——打包形态下
    // `profileDir` 是只读的 `Resources/runtime`，起始目录仍是用户从哪个项目启动的。
    const fallback = await bootstrapApplication({
      providers: [...provideAppEnv()],
      timeoutMs: 10_000,
    });
    opened.push(fallback);
    const defaulted = fallback.get(AppEnv);
    expect(defaulted.values.defaultWorkingDirectory).toBe(process.cwd());
    expect(defaulted.defaultWorkingDirectory).toBe(process.cwd());
    // `dataDir` 的缺省跟着算好的 `profileDir` 走（cwd 只读一次）。
    expect(defaulted.values.dataDir).toBe(join(process.cwd(), ".dsh-store"));

    // 覆盖：装配面说了算（启动参数 `--cwd` 那条链）。
    const workingDirectory = "/projects";
    const configured = await bootstrapApplication({
      providers: [
        ...provideAppEnv(
          configure(AppEnvDefault, {
            profileDir: "/profile",
            defaultWorkingDirectory: workingDirectory,
          }),
        ),
      ],
      timeoutMs: 10_000,
    });
    opened.push(configured);
    const env = configured.get(AppEnv);
    expect(env.values.defaultWorkingDirectory).toBe(workingDirectory);
    // 便捷读取与 `values` 是同一个值，不会各自漂移。
    expect(env.defaultWorkingDirectory).toBe(workingDirectory);
    // 起始目录与装配根是两件事：给了起始目录不会把装配根带走（反之亦然）。
    expect(env.values.profileDir).toBe("/profile");
  });
});

/** 各包手写替身的老形状：只给两条路径（`defaultWorkingDirectory` 是后加的，它们没跟着改）。 */
@Injectable()
class LegacyFieldsEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: "/data", profileDir: "/profile" };
  readonly cacheDir = "/data/cache";

  readonly profileManifest = "/profile/package.json";
}

describe("AppEnv 的字段是加法：旧替身不改也成立", () => {
  it("没给 defaultWorkingDirectory 的替身照样成立，读取兜底到 profileDir", () => {
    // 这条钉的是**跨包不受牵连**：契约加字段不该逼着二十几个包的 FakeAppEnv 一起改。
    const env = new LegacyFieldsEnv();
    expect(env.values.defaultWorkingDirectory).toBeUndefined();
    expect(env.defaultWorkingDirectory).toBe("/profile");
  });
});

// 用例支撑：一份「真起得来」的最小 dev 清单（web + dev 行），app 目录是一个静态夹具。
//
// 为什么用真 vite 起（而不是替身 `ViteHandoff`）：`startDev` 的判据是「首页 200、close 后端口释放」——
// 那两条只有在**真的**有 http 服务与 vite 时才成立；替身会让用例变成「测自己写的替身」。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { bootstrapApplication, Injectable, type App, without } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues, WebStartup } from "@morlay/zephyr-app";
import {
  provideApiGateway,
  provideTypert,
  provideWeb,
  WebStartupDefault,
} from "@morlay/zephyr-app/testing";
import { appBootDirOf } from "../../internal/package-root.ts";
import { devProviders } from "../../dev/provide.ts";

/** 夹具应用目录（`src/client/index.html` + `index.ts`）。 */
export const DEV_FIXTURE = new URL("../fixtures/dev-app/", import.meta.url).pathname;

/** 一次装配好、但还没起来的 dev 环境。 */
export interface DevFixture {
  readonly app: App;
  readonly dataDir: string;
  readonly repoRoot: string;
  readonly appRoot: string;
  readonly cacheDir: string;
}

/**
 * 装配一棵 dev 行树：端口取 0（并行 spec 不抢端口），数据根在 tmpdir。
 * @param mode - `devProviders` 的开关（形态与两半 HMR；缺省非打包、HMR 全开）。
 * @returns 行树与四个部署事实。
 */
export async function mountDev(
  mode: Omit<Parameters<typeof devProviders>[0], "packaged"> = {},
): Promise<DevFixture> {
  const dataDir = await mkdtemp(join(tmpdir(), "zephyr-dev-start-"));
  // 紧跟着就登记清理：用例中途失败也不留（测试根目录在项目的 `.tmp/` 下）。
  onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
  const repoRoot = DEV_FIXTURE;
  const cacheDir = join(dataDir, "cache", "vite");
  @Injectable()
  class Env extends AppEnv {
    readonly values: AppEnvValues = {
      profileDir: repoRoot,
      dataDir,
      defaultWorkingDirectory: repoRoot,
    };

    readonly cacheDir = join(dataDir, "cache");

    readonly profileManifest = join(repoRoot, "package.json");
  }
  const app = await bootstrapApplication({
    providers: [
      Env,
      // 端口/地址写在值行里（`WebStartupDefault` 读环境变量，并行用例会互相抢 3080）。
      ...provideWeb(without(WebStartupDefault)),
      { provide: WebStartup, useValue: { values: { port: 0, host: "127.0.0.1" } } },
      // 宿主运行时：dev 行要 WebServer（端口）；wire 载体由上游 api-gateway 注册（要 webServer）。
      ...provideTypert(),
      ...provideApiGateway(),
      ...devProviders({ packaged: false, ...mode }),
    ],
    timeoutMs: 60_000,
  });
  return { app, dataDir, repoRoot, appRoot: appBootDirOf(repoRoot), cacheDir };
}

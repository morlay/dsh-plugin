// 测试的**运行环境夹具**：`AppEnv` 替身与它的临时目录一起给、一起收。
//
// 临时目录不是测试的目的，它只是 `AppEnv` 的实现细节：各 spec 各写一份 `class FakeAppEnv extends AppEnv`
// （字段完全相同、只差目录）再配 `let root` + `beforeAll` + `afterAll`，说的都是同一件事。
// 这里一次说清：fixture 给替身，替身里的 `dataDir` 就是那个测试专属的临时目录，测试结束自动删。
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@morlay/zephyr/testing";
import { AppEnv, type AppEnvValues } from "../app-env/app-env.contract.ts";

/** `TestingAppEnv` 的可覆盖项。 */
export interface TestingAppEnvOptions {
  /** 本用例的临时目录（`dataDir` 与起始目录都指向它）。 */
  readonly root: string;
  /**
   * 装配根（`package.json` 所在目录）：缺省与 {@link TestingAppEnvOptions.root} 相同。
   *
   * 少数用例要把「装配根」指到别处（federation 的假包宿主是仓库里的 fixtures 目录），
   * 那时显式给；它**不**跟着临时目录走。
   */
  readonly profileDir?: string;
  /**
   * 新会话 / agent 的起始目录：缺省与 {@link TestingAppEnvOptions.root} 相同。
   *
   * 只有「工作区不在数据根上」的用例才给（federation 的 fixtures 目录就是这种）。
   */
  readonly workingDirectory?: string;
}

/**
 * `AppEnv` 的测试替身：路径全部指向**本用例**的临时目录。
 *
 * 为什么不用 `configure(AppEnvDefault, …)`：`AppEnvDefault` 的 `values` 是类字段初值，配置进不去，
 * 于是 `dataDir` 会落在进程 cwd 上，测试互相污染（同一 session id 的 header 在多次运行之间残留）。
 */
export class TestingAppEnv extends AppEnv {
  /** 本用例的临时目录（`dataDir` 与起始目录都指向它）。 */
  readonly root: string;

  readonly values: AppEnvValues;

  readonly cacheDir: string;

  readonly profileManifest: string;

  /**
   * @param options - 临时目录与（可选的）装配根。
   */
  constructor(options: TestingAppEnvOptions) {
    super();
    this.root = options.root;
    const profileDir = options.profileDir ?? options.root;
    this.values = {
      dataDir: options.root,
      profileDir,
      defaultWorkingDirectory: options.workingDirectory ?? options.root,
    };
    this.cacheDir = join(options.root, "cache");
    this.profileManifest = join(profileDir, "package.json");
  }
}

/**
 * 显式造一份替身（fixture 之外的场合：要改 `profileDir`，或要把它当值条目交给装配）。
 * @param options - 临时目录与（可选的）装配根。
 * @returns 替身实例。
 */
export function createTestingAppEnv(options: TestingAppEnvOptions): TestingAppEnv {
  return new TestingAppEnv(options);
}

/** 本出口提供的 fixture。 */
export interface AppEnvFixtures {
  /** 本用例的运行环境替身；它的 `values.dataDir` 就是那份临时目录。 */
  readonly appEnv: TestingAppEnv;
}

/** 已经带上 `appEnv` 的 `test`：spec 一律从这里 import。 */
export const test = base.extend<AppEnvFixtures>({
  async appEnv({}, use) {
    // 归一成 canonical 路径：macOS 上 `/var` 指向 `/private/var`，断言「解析出来的路径」时会对不上。
    const root = await realpath(await mkdtemp(join(tmpdir(), "zephyr-spec-")));
    await use(new TestingAppEnv({ root }));
    await rm(root, { recursive: true, force: true });
  },
});

export { describe, expect } from "@morlay/zephyr/testing";

// 配置文件的替身：把 toml 文本直接给进去，测试不碰真实 `$DSH_HOME`。
//
// 内容在**构造时**快照到实例上（工厂闭包），装配期构造完就与任何静态字段脱钩：同一条用例里
// 先后装两个 app（各带不同规则）也互不干扰。`text` 为 `undefined` 模拟文件不存在。
import { SandboxFile, SandboxRules, SandboxRulesDefault } from "@morlay/configurable-sandbox";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { createTestingAppEnv, type TestingAppEnv } from "@morlay/zephyr-app/testing";

/**
 * 造一个"配置文件替身"的行类（内容闭包在类里，不再有静态字段）。
 * @param text - `sandbox.toml` 的文本；`undefined` 表示文件不存在。
 * @returns 行类。
 */
export function fakeSandboxFileOf(text: string | undefined) {
  @Injectable()
  class FakeSandboxFile extends SandboxFile {
    readonly path = "/fake/sandbox.toml";

    async read(): Promise<string | undefined> {
      return text;
    }
  }
  return FakeSandboxFile;
}

/**
 * 只装"读配置 + 解析规则"这两行：断言落在 `SandboxRules` 的输出上，不牵动沙箱实现。
 *
 * `AppEnv` 是规则层取缺省 `cwd` 的唯一来源（它不读进程 cwd），所以装规则行就必须一起给。
 * 缺省初始目录是 `/sandbox-default-cwd`（不存在的绝对路径，正常用例不与真实磁盘交互）；
 * 调用方要给别的运行环境就从第二个参数传进来——**不存模块级变量**。
 * @param text - `sandbox.toml` 的文本；`undefined` 表示文件不存在。
 * @param appEnv - 运行环境（缺省造一个指向 `/sandbox-default-cwd` 的替身）。
 * @returns 规则面与卸载函数。
 */
export async function loadRules(
  text: string | undefined,
  appEnv: TestingAppEnv = createTestingAppEnv({ root: "/sandbox-default-cwd" }),
) {
  const app = await bootstrapApplication({
    providers: [
      { provide: AppEnv, useValue: appEnv },
      fakeSandboxFileOf(text),
      SandboxRulesDefault,
    ],
    timeoutMs: 5_000,
  } as never);
  return { rules: app.get(SandboxRules), dispose: () => app.dispose() };
}

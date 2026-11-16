// 配置文件的替身：把 toml 文本直接给进去，测试不碰真实 `$DSH_HOME`。
//
// 内容在**构造时**快照到实例上：装配期构造完就与静态字段脱钩，同一条用例里先后装两个 app
// （各带不同规则）也互不干扰。`text` 为 `undefined` 模拟文件不存在。
import { SandboxFile, SandboxRules, SandboxRulesDefault } from "@morlay/configurable-sandbox";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { FakeAppEnv } from "@morlay/zephyr-app/testing";

@Injectable()
export class FakeSandboxFile extends SandboxFile {
  static text: string | undefined = undefined;

  readonly path = "/fake/sandbox.toml";

  private readonly snapshot = FakeSandboxFile.text;

  async read(): Promise<string | undefined> {
    return this.snapshot;
  }
}

/**
 * 只装"读配置 + 解析规则"这两行：断言落在 `SandboxRules` 的输出上，不牵动沙箱实现。
 *
 * `AppEnv` 是规则层取缺省 `cwd` 的唯一来源（它不读进程 cwd），所以装规则行就必须一起给。
 * 初始目录用 `/sandbox-default-cwd`（一个不存在的绝对路径，正常用例不与真实磁盘交互）。
 *
 * `FakeAppEnv.root` 由**调用方**在调用前设好（它是静态的，在这里设就是隐式全局状态）。
 * @param text - `sandbox.toml` 的文本；`undefined` 表示文件不存在。
 * @returns 规则面与卸载函数。
 */
export async function loadRules(text: string | undefined) {
  FakeSandboxFile.text = text;
  const app = await bootstrapApplication({
    providers: [FakeAppEnv, FakeSandboxFile, SandboxRulesDefault],
    timeoutMs: 5_000,
  });
  return { rules: app.get(SandboxRules), dispose: () => app.dispose() };
}

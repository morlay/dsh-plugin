// 配置文件的替身：把 toml 文本直接给进去，测试不碰真实 `$DSH_HOME`。
//
// 内容在**构造时**快照到实例上：装配期构造完就与静态字段脱钩，同一条用例里先后装两个 app
// （各带不同规则）也互不干扰。`text` 为 `undefined` 模拟文件不存在。
import { SandboxFile, SandboxRules, SandboxRulesDefault } from "@morlay/configurable-sandbox";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";

@Injectable()
export class FakeSandboxFile extends SandboxFile {
  static text: string | undefined = undefined;

  readonly path = "/fake/sandbox.toml";

  private readonly snapshot = FakeSandboxFile.text;

  async read(): Promise<string | undefined> {
    return this.snapshot;
  }
}

// 只装"读配置 + 解析规则"这两行：断言落在 `SandboxRules` 的输出上，不牵动沙箱实现。
export async function loadRules(text: string | undefined) {
  FakeSandboxFile.text = text;
  const app = await bootstrapApplication({
    providers: [FakeSandboxFile, SandboxRulesDefault],
    timeoutMs: 5_000,
  });
  return { rules: app.get(SandboxRules), dispose: () => app.dispose() };
}

// pi-ai LLM provider（纯实现行，不声明契约）：设置项由 `@Setting` 声明。
import * as LlmPiAiPlugin from "@deepseek-ai/dsh-llm-pi-ai";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SettingDeclaration as Setting, settingRow } from "@morlay/dsh-setting";
import { Llm } from "./contract/index.ts";
import { LaunchEnvironment } from "./contract/launch-environment.contract.ts";
import { resolveHeaderReferences } from "./llm-pi-ai-headers.ts";

@Injectable()
@Setting({ ns: "llm-pi-ai", config: LlmPiAiPlugin.Config })
export class LlmPiAi extends settingRow(fromCordis(LlmPiAiPlugin)) {
  llm = inject(Llm);

  /** 启动环境快照：装配里 `providers[*].headers` 的 `${NAME}` 引用按它解析。 */
  private readonly launchEnvironment = inject.optional(LaunchEnvironment);

  protected settingDeps(): Record<string, unknown> {
    return { llm: this.llm };
  }

  /**
   * 挂载前把 header 里的环境引用解析成真值。
   *
   * 解析结果只进**运行期 config**（`mount` 的入参），不进装配层的 `rowConfig`：
   * `settings/describe` 的 `base` 读的是后者，装配里写的只是引用字符串，密钥不下发浏览器。
   */
  override async mount(
    ctx: Context,
    config?: unknown,
    deps?: Record<string, unknown>,
  ): Promise<void> {
    await super.mount(ctx, resolveHeaderReferences(config, this.launchEnvironment?.snapshot), deps);
  }
}

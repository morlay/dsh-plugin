// DeepSeek API key provider（纯实现行，不声明契约）：设置项由 `@Setting` 声明。
import * as LlmDeepseekPlugin from "@deepseek-ai/dsh-llm-deepseek-api-key";
import { inject, Injectable } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SettingDeclaration as Setting, settingRow } from "@morlay/dsh-setting";
import { Llm } from "./contract/index.ts";

@Injectable()
@Setting({ ns: "llm-deepseek-api-key", config: LlmDeepseekPlugin.Config })
export class LlmDeepseek extends settingRow(fromCordis(LlmDeepseekPlugin)) {
  llm = inject(Llm);

  protected settingDeps(): Record<string, unknown> {
    return { llm: this.llm };
  }
}

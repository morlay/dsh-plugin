// pi-ai LLM provider（纯实现行，不声明契约）：设置项由 `@Setting` 声明。
import * as LlmPiAiPlugin from "@deepseek-ai/dsh-llm-pi-ai";
import { inject, Injectable } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SettingDeclaration as Setting, settingRow } from "@morlay/dsh-setting";
import { Llm } from "./contract/index.ts";

@Injectable()
@Setting({ ns: "llm-pi-ai", config: LlmPiAiPlugin.Config })
export class LlmPiAi extends settingRow(fromCordis(LlmPiAiPlugin)) {
  llm = inject(Llm);

  protected settingDeps(): Record<string, unknown> {
    return { llm: this.llm };
  }
}

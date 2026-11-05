// DeepSeek API key provider（纯实现行，不声明契约）。
import * as LlmDeepseekPlugin from "@deepseek-ai/dsh-llm-deepseek-api-key";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "@morlay/dsh-agent";
import { Setting } from "./contract/setting.contract.ts";
import { SettingSchema } from "./setting-schema.service.ts";

@Injectable()
export class LlmDeepseek extends fromCordis(LlmDeepseekPlugin) {
  llm = inject(Llm);

  private readonly schemas = inject(SettingSchema);

  /** 设置文档：这一行的命名空间写着它的配置（变更时按新值重挂载）。 */
  private readonly setting = inject.optional(Setting);

  /** 行配置（清单条目给的默认值；基类接住构造参数）。 */
  /** 行配置（清单条目给的默认值；基类接住构造参数）。 */
  private get rowOptions(): Record<string, unknown> {
    // `rowConfig` 是适配基类接住的装配值（`mount` 的缺省值），这里只做类型收窄。
    return (this.rowConfig ?? {}) as Record<string, unknown>;
  }

  override async onInit(ctx: Context): Promise<void> {
    // 先应用**持久化**的配置：`settings.json` 里的值在启动时就该生效（不然只有「改了以后」才生效）。
    const persisted = this.setting?.snapshot()["llm-deepseek-api-key"];
    const config =
      typeof persisted === "object" && persisted !== null
        ? { ...this.rowOptions, ...persisted }
        : this.rowOptions;
    await this.mount(ctx, config, { llm: this.llm });
    // 本条 provider 的配置 schema（schemastery 的 JSON）：设置页用 `new Schema(json)` 重建表单。
    this.schemas.register("llm-deepseek-api-key", LlmDeepseekPlugin.Config.toJSON());
  }
}

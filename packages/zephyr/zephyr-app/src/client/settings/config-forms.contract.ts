// 配置表单契约（上游 `dsh-client-ui-settings` 的 `configForms` 服务）：locale/theme 读各自命名空间的表单。
// 契约名与上游服务名一致（`configForms`），上游按名字读它。
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class ConfigForms {
  static readonly providerName = "configForms";

  abstract get<T>(entryId: string): ConfigForm<T>;

  /**
   * 开发者工具开关（上游 `configForms.developerTools`）。
   *
   * `ui-conversation` 在读：关闭时它不注册 trajectory（轨迹）视图。宿主没有设置面时恒为 `false`。
   */
  abstract readonly developerTools: {
    readonly enabled: { getSnapshot(): boolean; subscribe(listener: () => void): () => void };
    setEnabled(enabled: boolean): Promise<void>;
  };
}

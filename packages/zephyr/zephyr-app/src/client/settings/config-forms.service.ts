import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import { Injectable } from "@morlay/zephyr";
import { ConfigForms } from "./config-forms.contract.ts";

// **占位实现，且必须失败**：这个空实现只用来满足装配期依赖（`inject(ConfigForms)` 有东西可拿），
// 但真实现由 `SettingsHost`（上游 `ui-settings` 行）提供。
//
// `get()` **抛错而不是返回空 section**：空 section 会让 `ui-theme` / `ui-settings-models` 这类消费方
// 「拿到一个能用的对象、读出来是空」，于是主题静默不生效——这次的主题 bug 就是这条链上一环
// （真实现晚到，消费方订阅了空 section）。**空实现静默返回空值，比抛错糟得多**：报错你会去查，
// 静默你会以为功能本来就这样。
@Injectable()
export class ConfigFormsDefault extends ConfigForms {
  /** 开发者工具开关：没有宿主设置面时恒关（`ui-conversation` 只读它决定是否注册轨迹视图）。 */
  readonly developerTools = {
    enabled: {
      getSnapshot: (): boolean => false,
      subscribe: (): (() => void) => () => {},
    },
    setEnabled: async (_enabled: boolean): Promise<void> => {
      throw new Error("本装配没有开发者工具设置面");
    },
  };

  /**
   * 拿一个命名空间的配置表单。
   * @param _entryId - 命名空间。
   * @throws 永远：真实现由 `SettingsHost` 提供，本占位实现不返回空 section。
   */
  get<T>(_entryId: string): ConfigForm<T> {
    throw new Error(
      `ConfigForms 的真实现未装：需要装 SettingsHost（上游 ui-settings 行）。`
      + `本占位实现不会返回空 section——那会让消费方静默读到空配置（主题/模型页签就是这么失效的）。`,
    );
  }
}

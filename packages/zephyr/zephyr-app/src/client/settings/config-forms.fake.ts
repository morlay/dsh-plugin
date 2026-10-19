// **测试专用**的 `ConfigForms` 替身。
//
// 生产装配里 `ConfigFormsDefault`（`client/settings/config-forms.service.ts`）的 `get()` 会**抛错**：
// 空 section 会让消费方静默读到空配置（主题/模型页签失效过一次）。生产要的是装 `SettingsHost`。
//
// 但只装 `ClientChainModule` 的 spec（渲染冒烟、位置族）确实会经 `ui-locale` 间接 `get()` 一次；
// 它们不关心配置内容，也不该为了一个渲染用例去装整条 `ui-settings` 行（那还会把 `dsh-setting` 拖进
// `zephyr-app` 的依赖图）。所以给一个**显式的、只在 `@morlay/zephyr-app/testing` 出口里的**替身，
// 让「用了空实现」这件事在 spec 里是**写出来的**，而不是靠生产代码静默兜底。
import type { ConfigForm, ConfigFormSnapshot } from "@deepseek-ai/dsh-client-ui-settings/client";
import { Injectable } from "@morlay/zephyr";
import { ConfigForms } from "./config-forms.contract.ts";

/** 空配置快照（不可写）。 */
const EMPTY: ConfigFormSnapshot<unknown> = Object.freeze({
  status: "unavailable",
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
});

/** 测试替身：`get()` 返回一个不可写的空表单。 */
@Injectable()
export class ConfigFormsInMemory extends ConfigForms {
  private readonly forms = new Map<string, ConfigForm<unknown>>();

  /** 开发者工具开关：测试里恒关。 */
  readonly developerTools = {
    enabled: {
      getSnapshot: (): boolean => false,
      subscribe: (): (() => void) => () => {},
    },
    setEnabled: async (_enabled: boolean): Promise<void> => {},
  };

  /**
   * 拿一个命名空间的表单。
   * @param entryId - 命名空间。
   * @returns 不可写的空表单（同一个 ns 复用同一个对象）。
   */
  get<T>(entryId: string): ConfigForm<T> {
    const existing = this.forms.get(entryId);
    if (existing !== undefined) return existing as ConfigForm<T>;
    const form: ConfigForm<T> = {
      getSnapshot: (): ConfigFormSnapshot<T> => EMPTY as ConfigFormSnapshot<T>,
      subscribe: () => () => {},
      mutate: async (): Promise<boolean> => false,
      set: async (): Promise<boolean> => false,
      unset: async (): Promise<boolean> => false,
    };
    this.forms.set(entryId, form as ConfigForm<unknown>);
    return form;
  }
}

/**
 * 限额段的控制器：把两个可分别重置的限额（递归深度、并行上限）绑在同一个 staged 表单上。
 *
 * 保存才写：草稿先落在本地，`save` 一次性把两份编辑按 path op 提交，并带读回时的 revision 做栅栏。
 * 上游 `@deepseek-ai/dsh-client-ui-settings-subagent` 的同名控制器读 `subagent` 命名空间；本部署那行已被
 * 本包接管，所以这里读的是**本包行 id** `subagent-fork`（settings 的 namespace 名就是行 id）。
 */

import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import {
  SettingsFormModel,
  settingsNumberField,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
} from "@morlay/dsh-client-ui-primitives/client";

/** 本包 host 行 id：settings 的命名空间名与 `Config` 的 volatile 字段都在它下面。 */
export const SUBAGENT_NS = "subagent-fork";

/** host 侧的委派默认值与实时容量（`SubagentRuntime.Config` 的两个 volatile 字段）。 */
export interface SubagentLimitsSettings {
  maxDepth: number;
  maxActiveSubagents: number;
}

/** 限额卡片呈现的生效值与草稿。 */
export interface SubagentLimitsCardState extends SettingsFormShell {
  maxDepth: SettingsFieldState;
  maxActiveSubagents: SettingsFieldState;
}

/** 槽位渲染器绑定的动作与可观察状态。 */
export interface SubagentLimitsCardFace extends SettingsFormActions {
  hooks: {
    subagentLimitsCard: SnapshotStore<SubagentLimitsCardState>;
  };
}

/**
 * 一个整数限额字段：空草稿＝清除（回到默认），其余草稿必须是该字段下限之上的安全整数。
 * 上游的同名实现就是这样卡住非法输入的——非法草稿保留在屏幕上并阻止保存，而不是被悄悄丢弃。
 * @param field - 命名空间段内的字段名。
 * @param minimum - 该字段接受的最小值。
 * @returns 该字段的转换规则。
 */
function limitField(field: keyof SubagentLimitsSettings, minimum: number): SettingsFieldSpec {
  const numeric = settingsNumberField(field);
  return {
    ...numeric,
    parse: (text) => {
      const write = numeric.parse(text);
      if (write?.kind !== "set") return write;
      const value = write.value as number;
      return Number.isSafeInteger(value) && value >= minimum && !Object.is(value, -0)
        ? write
        : undefined;
    },
  };
}

/** 把两个限额绑在一个 staged 表单上。 */
export class SubagentLimitsCardController {
  private readonly form: SettingsFormModel<SubagentLimitsSettings>;
  private readonly store: SnapshotStore<SubagentLimitsCardState>;

  /**
   * @param scope - 本包 host 行（`subagent-fork`）的共享配置表单。
   */
  constructor(scope: SettingsFormScope<SubagentLimitsSettings>) {
    this.form = new SettingsFormModel(scope, [
      limitField("maxDepth", 0),
      limitField("maxActiveSubagents", 1),
    ]);
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      maxDepth: this.form.field("maxDepth"),
      maxActiveSubagents: this.form.field("maxActiveSubagents"),
    }));
  }

  /**
   * 把限额编辑器绑到槽位渲染器上。
   * @returns 限额快照与 staged 写动作。
   */
  inject(): SubagentLimitsCardFace {
    return { hooks: { subagentLimitsCard: this.store }, ...this.form.actions() };
  }

  /** 释放对已接受值的订阅。 */
  dispose(): void {
    this.form.dispose();
  }
}

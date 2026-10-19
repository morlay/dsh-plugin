import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { SettingsPathOpView } from "@deepseek-ai/dsh-api-remotes/client";
import { Injectable } from "@morlay/zephyr";
import { ConfigForms } from "./config-forms.contract.ts";

// 最小实现：官方 settings 行（`dsh-client-ui-settings/client`）要 `remote.settings` 这个上游 namespace 服务，
// 它由 gateway 的 `$mount` 装到 Remote 行的行内，跨行不可达（见 .agents/designs 的取舍）。这里给"没有宿主
// 文档"的形态：表单不可用、写入一律被拒；locale/theme 读到空值即用默认语言/主题。
const UNAVAILABLE: ConfigFormSnapshot<unknown> = Object.freeze({
  status: "unavailable",
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
});

function unavailableForm<T>(): ConfigForm<T> {
  return {
    getSnapshot: () => UNAVAILABLE as ConfigFormSnapshot<T>,
    subscribe: () => () => {},
    mutate: async (_ops: readonly SettingsPathOpView[], _expectedRevision?: number) => false,
    set: async (_field: string, _value: unknown) => false,
    unset: async (_field: string) => false,
  };
}

@Injectable()
export class ConfigFormsDefault extends ConfigForms {
  private readonly forms = new Map<string, ConfigForm<unknown>>();

  get<T>(entryId: string): ConfigForm<T> {
    const existing = this.forms.get(entryId);
    if (existing !== undefined) return existing as ConfigForm<T>;
    const form = unavailableForm<T>();
    this.forms.set(entryId, form as ConfigForm<unknown>);
    return form;
  }
}

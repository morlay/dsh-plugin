import type {
  ConfigForms as ConfigFormsService,
  SettingsSchemaService,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import { InjectionToken } from "@morlay/zephyr";

export const ConfigForms = new InjectionToken<ConfigFormsService>("configForms", {
  host: "@deepseek-ai/dsh-client-ui-settings",
});

export const SettingsSchema = new InjectionToken<SettingsSchemaService>("settingsSchema", {
  host: "@deepseek-ai/dsh-client-ui-settings",
});

// 提示面的读侧 + 注册侧（与内联实现的契约同形，但不依赖它的包）。
export interface SchemaFormHintsLike {
  suggestKeys(
    ns: string,
    path: readonly string[],
    read: () => readonly string[],
  ): () => void;

  keysFor(ns: string, path: readonly string[]): readonly string[];

  describe(
    ns: string,
    path: readonly string[],
    read: () => { label?: string; hint?: string },
  ): () => void;

  textFor(ns: string, path: readonly string[]): { label?: string; hint?: string };

  select(ns: string, path: readonly string[], spec: any): () => void;

  selectFor(ns: string, path: readonly string[]): any;

  source(name: string, spec: any): () => void;

  sourceFor(name: string): any;

  subscribe(listener: () => void): () => void;

  refresh(): void;
}

// 提供方是本仓库内联的 client 面（不靠 loader 装载），不声明 host。
export const SchemaFormHints = new InjectionToken<SchemaFormHintsLike>("schemaFormHints");

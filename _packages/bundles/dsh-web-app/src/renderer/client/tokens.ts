import { InjectionToken } from "@morlay/zephyr";

// 座位注册面：`locale` 是字典命名空间（字符串），不依赖上游的 LocaleNamespaceMap 增强。
export interface SlotEntryLike {
  name: string;
  key?: string;
  id?: string;
  order?: number;
  label?: () => string;
  locale?: string;
  inject?: () => unknown;
}

export interface SlotsLike {
  register(entry: SlotEntryLike, component: unknown): () => void;

  inject(name: string, read: () => unknown): () => void;
}

export const Slots = new InjectionToken<SlotsLike>("slots", {
  host: "@deepseek-ai/dsh-client-ui-renderer",
});

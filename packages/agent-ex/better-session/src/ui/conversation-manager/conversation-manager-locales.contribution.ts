// 本包字典的唯一注册处：上游 `locale.register` 对同一 namespace + locale 二次注册会抛，
// 所以页面视图与 nav 行都只经这里 `bind`，不各自注册。
import { inject } from "@morlay/zephyr";
import { Locale, Slot, SlotContribution } from "@morlay/zephyr-app/client";
import { NS, en, zh } from "./locales.ts";
import type { ConversationManagerKey } from "./locales.ts";

/** 本包字典的翻译座：`t` 的键集合就是字典的键集合。 */
export type ConversationManagerTranslate = (
  key: ConversationManagerKey,
  params?: Record<string, unknown>,
) => string;

// 字典面按结构使用：字典名只在本包注册，不扩张上游的 namespace 类型表。
interface Dictionaries {
  register(ns: string, dicts: Readonly<Record<string, Readonly<Record<string, string>>>>): unknown;
  bind(ns: string): ConversationManagerTranslate;
}

@Slot({})
export class ConversationManagerLocales extends SlotContribution {
  private readonly locale = inject(Locale) as unknown as Dictionaries;

  override onInit(): void {
    this.locale.register(NS, { zh, en });
    super.onInit();
  }

  /** 本包字典绑定后的翻译座。 */
  t(): ConversationManagerTranslate {
    return this.locale.bind(NS);
  }
}

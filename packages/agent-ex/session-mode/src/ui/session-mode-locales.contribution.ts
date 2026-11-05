// 本包字典的唯一注册处：上游 `locale.register` 对同一 namespace + locale 二次注册会抛，
// 所以 tab 类型、chip、面板都只经这里 `bind`，不各自注册。
//
// 没有这一条时，右栏 tab 与 guide 入口显示的是**原始键**（`panel` / `panelDescription`）——
// 实测在浏览器里就是这个症状。
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Locale } from "@morlay/zephyr-app/client";
import { LOCALE_NS, en, zh, type SessionModeLocaleKey } from "./locales.ts";

/** 本包字典的翻译座：`t` 的键集合就是字典的键集合。 */
export type SessionModeTranslate = (key: SessionModeLocaleKey) => string;

/** 字典面按结构使用：字典名只在本包注册，不扩张上游的 namespace 类型表。 */
interface Dictionaries {
  register(ns: string, dicts: Readonly<Record<string, Readonly<Record<string, string>>>>): unknown;
  bind(ns: string): (key: string) => string;
}

@Injectable()
export class SessionModeLocales implements OnInit {
  private readonly locale = inject(Locale) as unknown as Dictionaries;

  onInit(): void {
    this.locale.register(LOCALE_NS, { zh, en });
  }

  /** 本包字典绑定后的翻译座。 */
  t(): SessionModeTranslate {
    return this.locale.bind(LOCALE_NS) as SessionModeTranslate;
  }
}

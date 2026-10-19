// 语言目录契约（上游 `dsh-client-locale` 的 `locale` 服务）：layout、theme、shortcuts 按名字读它。
import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Locale {
  abstract readonly bind: LocaleRuntime["bind"];

  /** 注册一份字典（上游 `locale.register(ns, locale, dict)`）。 */
  abstract readonly register: LocaleRuntime["register"];

  abstract readonly getSnapshot: LocaleRuntime["getSnapshot"];

  abstract readonly subscribe: LocaleRuntime["subscribe"];
}

import { Locale, type LocaleFace } from "@morlay/dsh-web-app/locale/client/tokens";
import { SchemaFormHints, type SchemaFormHintsLike } from "@morlay/dsh-web-app/settings/client/tokens";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { en, zh, type WebSearchFieldLocaleKey } from "./locales.ts";

// 本包 host 行 id：行配置页读的就是这个命名空间。
export const WEB_SEARCH_NS = "web-search-ollama";

// 本页字典的命名空间（命名空间键就是这里声明的串，不靠增强上游的 `LocaleNamespaceMap`）。
export const NS: string = "settings.web-search-ollama";

const FIELDS = ["apiKey", "apiKeyEnv", "baseURL", "maxResults"] as const;

@Injectable()
export class WebSearchFieldWording {
  locale = inject(Locale);

  hints = inject.optional(SchemaFormHints);

  onInit(ctx: Context): void {
    ctx.effect(() => fieldWordingOf(this.locale, this.hints), "web-search-ollama: field wording");
  }
}

// 字典 + 字段文案的注册；返回卸载函数。提示面缺席时只挂字典（老组合安静跳过）。
export function fieldWordingOf(
  locale: LocaleFace,
  hints: Pick<SchemaFormHintsLike, "describe"> | undefined,
): () => void {
  const offs = [locale.register(NS, "zh", zh), locale.register(NS, "en", en)];
  if (hints !== undefined) {
    const t = locale.bind(NS);
    for (const key of FIELDS) {
      offs.push(
        hints.describe(WEB_SEARCH_NS, [key], () => ({
          label: t(key),
          hint: t(`${key}Hint`),
        })),
      );
    }
  }
  return () => {
    for (const off of offs) off();
  };
}

export type { WebSearchFieldLocaleKey };

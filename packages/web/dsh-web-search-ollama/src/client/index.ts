/**
 * client 半：这一行的配置页由通用 schema 表单按 volatile 字段生成（四个字段都能在页面上改，改完下一次请求就
 * 生效），本包只把英文键名换成中文标签与说明。
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { en, zh, type WebSearchFieldLocaleKey } from "./locales.ts";

/** 本包 host 行 id：行配置页读的就是这个命名空间。 */
export const WEB_SEARCH_NS = "web-search-ollama";

/** 本页字典的命名空间。 */
export const NS = "settings.web-search-ollama";

/** 认领的字段名。 */
const FIELDS = ["apiKey", "apiKeyEnv", "baseURL", "maxResults"] as const;

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 设置页里这一行的字段文案。 */
    "settings.web-search-ollama": WebSearchFieldLocaleKey;
  }
}

/** 需要的服务：槽位（字段槽）与字典。 */
export const inject = ["locale"];

/**
 * 给这一行的四个字段补文案。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "web-search-ollama: field locale");
  ctx.effect(() => {
    const hints = ctx.get("schemaFormHints");
    if (hints === undefined) return () => {};
    const offs = FIELDS.map((key) =>
      hints.describe(WEB_SEARCH_NS, [key], () => ({
        label: t(key),
        hint: t(`${key}Hint` as WebSearchFieldLocaleKey),
      })),
    );
    return () => {
      for (const off of offs) off();
    };
  }, "web-search-ollama: field wording");
}

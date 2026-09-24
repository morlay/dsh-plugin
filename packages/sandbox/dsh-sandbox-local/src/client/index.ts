/**
 * client 半：这一行的配置页由通用 schema 表单按 volatile 字段生成（`access` 是页面可改的那一项，改完规则
 * 当场重算），本包只把键名换成中文标签与说明。
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { en, zh, type SandboxFieldLocaleKey } from "./locales.ts";

/** 本包 host 行 id：行配置页读的就是这个命名空间。 */
export const SANDBOX_NS = "sandbox-local";

/** 这一行里需要中文文案的字段。 */
const FIELDS = ["access"] as const;

/** 本页字典的命名空间。 */
export const NS = "settings.sandbox-local";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 设置页里这一行的字段文案。 */
    "settings.sandbox-local": SandboxFieldLocaleKey;
  }
}

/** 需要的服务：槽位（字段槽）与字典。 */
export const inject = ["locale"];

/**
 * 给 `access` 补文案。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "sandbox-local: field locale");
  ctx.effect(() => {
    const hints = ctx.get("schemaFormHints");
    if (hints === undefined) return () => {};
    const offs = FIELDS.map((key) =>
      hints.describe(SANDBOX_NS, [key], () => ({
        label: t(key),
        hint: t("accessHint"),
      })),
    );
    return () => {
      for (const off of offs) off();
    };
  }, "sandbox-local: field wording");
}

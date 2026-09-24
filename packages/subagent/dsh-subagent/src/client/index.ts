/**
 * client 半：这一行的配置页由通用 schema 表单按 volatile 字段生成，本包只**补字段文案**。
 *
 * 两个限额字段与上游逐行一致（薄壳 fork 的同步纪律），所以说明不能写在 host 的 Config 上——那会打破
 * 「index.ts 与上游逐行一致」的守护。字段槽 `settings.schema-form.field` 正好是为此而设：按
 * `ns = 'subagent-fork'` 认领这两个字段，给中文标签与说明，控件仍用通用面的默认控件。
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { en, zh, type SubagentFieldLocaleKey } from "./locales.ts";

/** 本包 host 行 id：settings 命名空间与行配置入口的 key 都用它。 */
export const SUBAGENT_NS = "subagent-fork";

/** 这一行里需要中文文案的字段。 */
const FIELDS = ["maxDepth", "maxActiveSubagents"] as const;

/** 本页字典的命名空间。 */
export const NS = "settings.subagent";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 设置页里这一行的字段文案。 */
    "settings.subagent": SubagentFieldLocaleKey;
  }
}

/** 需要的服务：槽位（字段槽）与字典。 */
export const inject = ["locale"];

/**
 * 给这一行的两个限额字段补文案。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-subagent: field locale");
  // 提示面由行配置表单提供：等它可用再注册（`ctx.get` 在它还没提供时拿不到，注册会被静静跳过）。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const hints = scope.schemaFormHints;
      const offs = FIELDS.map((key) =>
        hints.describe(SUBAGENT_NS, [key], () => ({
          label: t(key),
          hint: t(`${key}Hint` as SubagentFieldLocaleKey),
        })),
      );
      return () => {
        for (const off of offs) off();
      };
    }, "dsh-subagent: field wording"),
  );
}

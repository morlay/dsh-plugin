import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { en, zh, type SandboxFieldLocaleKey } from "./locales.ts";

// 本包 host 行 id：行配置页读的就是这个命名空间。
export const SANDBOX_NS = "sandbox-local";

// 本页字典的命名空间。
export const NS = "settings.sandbox-local";

const FIELDS = ["access"] as const;

import { Locale } from "@morlay/dsh-web-app/locale/client/tokens";
import { SchemaFormHints } from "@morlay/dsh-web-app/settings/client/tokens";

// 这一行的字段文案：依赖在字段上声明，注册行为在 onInit 里。
@Injectable()
export class SandboxFieldWording {
  locale = inject(Locale);

  // 老组合没有提示面：缺席就安静跳过。
  hints = inject.optional(SchemaFormHints);

  onInit(ctx: Context): void {
    const t = this.locale.bind(NS);
    ctx.effect(() => this.locale.register(NS, { zh, en }), "sandbox-local: field locale");

    const hints = this.hints;
    if (hints === undefined) return;
    ctx.effect(() => {
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
}

export type { SandboxFieldLocaleKey };

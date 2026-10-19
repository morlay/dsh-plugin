import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";
import { InjectionToken } from "@morlay/zephyr";

// 令牌名就是 ctx 的服务名（`locale` ↔ `ctx.locale`）：注入按名字解析，不需要再包 Provider。
// `host` 是提供该值的 client 插件包，构建期据此生成 `dsh.client.inject`。

// 只注册字典、只按命名空间取译文的消费者要的最小面（其余方法留在适配层）。
export interface LocaleFace {
  bind(ns: string): (key: string) => string;
  register(ns: string, locale: string, dict: Record<string, string>): () => void;
}

export const Locale = new InjectionToken<LocaleRuntime>("locale", {
  host: "@deepseek-ai/dsh-client-locale",
});

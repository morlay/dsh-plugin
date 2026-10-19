// client 半入口：只做 `toCordis(...)` 与公开 re-export；Provider 实现见 `./zephyr.service.ts`。

import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { toCordis } from "@morlay/zephyr/compat";
import type { BundleLocaleKey } from "./bundle-locales.ts";
import type { SessionModeLocaleKey } from "./locales.ts";
import { SessionModeClient } from "./zephyr.service.ts";

export type { SessionModeSeatProps } from "./SessionModeSeat.tsx";
export type { SessionModeLocaleKey } from "./locales.ts";
export type { BundleConfigPageProps } from "./BundleConfigPage.tsx";
export { NS, SESSION_MODE_NS, SessionModeClient } from "./zephyr.service.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    // 会话里两个面的文案（本行配置页的文案在通用 schema 表单的字典里）。
    "session-mode": SessionModeLocaleKey;
    // bundle 配置页（`plugins.bundle.config`）的文案。
    "session-mode-bundle": BundleLocaleKey;
  }
}

export default toCordis(SessionModeClient);

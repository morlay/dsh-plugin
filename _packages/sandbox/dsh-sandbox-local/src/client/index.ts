import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { toCordis } from "@morlay/zephyr/compat";
import type { SandboxFieldLocaleKey } from "./locales.ts";
import { SandboxFieldWording } from "./zephyr.service.ts";

export { NS, SANDBOX_NS, SandboxFieldWording } from "./zephyr.service.ts";
export type { SandboxFieldLocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    // 设置页里这一行的字段文案。
    "settings.sandbox-local": SandboxFieldLocaleKey;
  }
}

export default toCordis(SandboxFieldWording);

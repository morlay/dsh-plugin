import { toCordis } from "@morlay/zephyr/compat";
import { WebSearchFieldWording } from "./zephyr.service.ts";

export { NS, WEB_SEARCH_NS, WebSearchFieldWording } from "./zephyr.service.ts";
export type { WebSearchFieldLocaleKey } from "./locales.ts";

// 本行只挂自己：locale / schemaFormHints 都是宿主 ctx 的槽位，令牌按名字直接解析。
export default toCordis(WebSearchFieldWording);

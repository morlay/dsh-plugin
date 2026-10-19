import { toCordis } from "@morlay/zephyr/compat";
import { Config, WebSearchOllama } from "./zephyr.service.ts";

// dsh 行入口：Loader 取 default export；行 id 由 Provider token 名派生。
// 依赖由 Provider 自己的字段注入解析（Web 走适配令牌、launchEnvironment 走 ctx 槽位），
// 不再在这里列 providers。
export default toCordis(WebSearchOllama, { Config });

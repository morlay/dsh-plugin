// `sessions` 服务的**读面令牌**（上游注册名 `session-controller`）。
//
// 为什么不 `inject(SessionController)`：那个令牌的名字是类名 `"SessionController"`，与上游注册名对不上，
// `adoptNamedServices` 采不到它；而这里要的只是上游 `ISessions` 的读面（`search` / `using` / `list` /
// `searchResultLimit`）。取上游注册名建一条令牌，装配期就会把上游发布的实例自动采纳进来——
// 强类型、无断言、无环（只依赖 api 层的**类型**，不依赖 conversation）。
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import { InjectionToken } from "@morlay/zephyr";

export const SessionDirectory = new InjectionToken<ISessions>("session-controller");

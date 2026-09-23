/**
 * client 半：把模式的选择面注册到官方 agent preset 曾占的两个位置。
 *
 * | 槽位                                     | 呈现                                          |
 * | ---------------------------------------- | --------------------------------------------- |
 * | `conversation.hero.agentPreset`          | 新会话屏幕的顶部占位——chip 点开就是切换列表   |
 * | `conversation.session.header.actions`    | 会话头部的只读模式标签（`order: -10`，贴标题） |
 *
 * 官方的 `@deepseek-ai/dsh-client-ui-agent-preset` 在装配里被禁用（它同时带来设置页那块 roster 面板），
 * 所以这三个面都归我们：这里只做前两个，设置页不做——模式清单是装配配置（`session-mode` 行的
 * `config.modes`），改它不需要页面。
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：槽位声明与 standard props（session / session-maybe / global）。
import type {} from "@morlay/dsh-client-ui-conversation/client";
import { SessionModeLabel } from "./SessionModeLabel.tsx";
import { SessionModeSeat } from "./SessionModeSeat.tsx";
import { en, zh, type SessionModeLocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 模式选择面的文案。 */
    "session-mode": SessionModeLocaleKey;
  }
}

/** 浏览器半插件的字典命名空间。 */
const NS = "session-mode";

export type { SessionModeLabelProps } from "./SessionModeLabel.tsx";
export type { SessionModeSeatProps } from "./SessionModeSeat.tsx";

/** 需要的服务：槽位与字典（会话列表经槽位的标准 props 到达组件，不必自己 inject）。 */
export const inject = ["slots", "locale"];

/**
 * 装上两个面。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-mode: dictionaries");

  // 两个面都要求会话流的上下文（hero 的座位与头部动作行挂在 conversation 上）。
  ctx.inject(["slots", "conversation"], (scope) => {
    scope.effect(() => {
      const seat = scope.slots.register(
        { name: "conversation.hero.agentPreset", locale: NS },
        SessionModeSeat,
      );
      const label = scope.slots.register(
        {
          name: "conversation.session.header.actions",
          id: "session-mode",
          // 静态会话上下文占头部前导的负序位（与官方那一行同位）。
          order: -10,
          locale: NS,
        },
        SessionModeLabel,
      );
      return () => {
        seat();
        label();
      };
    }, "session-mode: hero chip and header label");
  });
}

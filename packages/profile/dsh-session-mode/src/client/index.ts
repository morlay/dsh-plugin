/**
 * client 半：会话里的两个面（模式 chip 与头部标签）+ 设置页里那张「会话模式」卡片。
 *
 * | 槽位                                     | 呈现                                          |
 * | ---------------------------------------- | --------------------------------------------- |
 * | `conversation.hero.agentPreset`          | 新会话屏幕的顶部占位——chip 点开就是切换列表   |
 * | `conversation.session.header.actions`    | 会话头部的只读模式标签（`order: -10`，贴标题） |
 * | `plugins.row.config`（key 见下）         | 设置页里**本行**的配置入口：各模式的默认模型（`config.models`） |
 *
 * 官方的 `@deepseek-ai/dsh-client-ui-agent-preset` 在装配里被禁用（它同时带来设置页那块 roster 面板），
 * 所以这两个面归我们。设置页那张卡片编辑的是**各模式的默认模型**——配置事实（`config.models`），不是模式
 * 清单；模式清单仍然是装配配置，改它不需要页面。
 *
 * 卡片的数据面是 host 行的 settings namespace `session-mode`（namespace 名就是行 id）：host 行被描述出来
 * 之后（`configForms.whileServed`）条目才注册，行不在时条目也一起消失。注册到 `plugins.row.config` 而不是
 * 官方分组 `plugins.item`：后者按上游契约由官方那几张设置卡占用（一个 host 命名空间一个伴生包），行自己的
 * 配置就该挂在自己的行上——key 由 `SESSION_MODE_ROW_CONFIG_KEY` 给出。
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：槽位声明与 standard props（session / session-maybe / global）。
import type {} from "@morlay/dsh-client-ui-conversation/client";
import { ModelDefaultsCard } from "./ModelDefaultsCard.tsx";
import { SESSION_MODE_NS, ModelDefaultsCardController } from "./model-defaults-card-controller.ts";
import { SessionModeLabel } from "./SessionModeLabel.tsx";
import { SessionModeSeat } from "./SessionModeSeat.tsx";
import { fetchRoster } from "./api.ts";
import { en, zh, type SessionModeLocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 模式选择面与设置卡片的文案。 */
    "session-mode": SessionModeLocaleKey;
  }
}

/** 浏览器半插件的字典命名空间。 */
const NS = "session-mode";

/**
 * 本行的配置入口 key：`<bundle 包名>#<行 id>`。
 *
 * 页面侧由 `ui-plugin-manager` 的 `rowConfigKey(bundle, rowId)` 生成同一个串——bundle 是本包
 * （`dsh.profile.bundles` 里那一项），行 id 是本包 patch 里插的 `session-mode`。
 */
export const SESSION_MODE_ROW_CONFIG_KEY = "@morlay/dsh-session-mode#session-mode";

export type { ModelDefaultsCardProps } from "./ModelDefaultsCard.tsx";
export type {
  ModelDefaultsCardFace,
  ModelDefaultsCardState,
  ModelDefaultsRow,
  ModelDirectory,
  ModelDefaultsSources,
  SessionModeSettings,
} from "./model-defaults-card-controller.ts";
export { ModelDefaultsCardController, SESSION_MODE_NS } from "./model-defaults-card-controller.ts";
export type { SessionModeLabelProps } from "./SessionModeLabel.tsx";
export type { SessionModeSeatProps } from "./SessionModeSeat.tsx";
export type { SessionModeLocaleKey } from "./locales.ts";

/** 需要的服务：槽位与字典（会话列表经槽位的标准 props 到达组件，不必自己 inject）。 */
export const inject = ["slots", "locale"];

/**
 * 装上三个面。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-mode: dictionaries");

  // 会话里的两个面都要求会话流的上下文（hero 的座位与头部动作行挂在 conversation 上）。
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

  // 设置页那张卡片要 `configForms`（共享配置表单）、`remote.session`（模型目录）与 `plugins.item`
  // （Plugins 页的槽）。它们都可能比本行晚到、或在这个部署里根本没有，所以走 `ctx.inject` 与
  // `slots.inject` 等它们就位——本行的基础 `inject` 不点它们，缺了也不影响上面两个面。
  ctx.inject(["slots", "locale", "configForms", "remote", "remote.session"], (forms) => {
    const t = forms.locale.bind(NS);
    forms.effect(() => {
      const controller = new ModelDefaultsCardController(
        forms.configForms.get(SESSION_MODE_NS),
        {
          roster: fetchRoster,
          // 目录只在打开卡片时读一次：它决定选择器的选项，页面生命周期里不会变。
          directory: async () => {
            const response = await forms.remote.session.modelCatalog();
            if (!response.ok) throw new Error("model catalog is unavailable");
            return {
              groups: response.value.groups,
              failures: response.value.failures.map((failure) => failure.name),
            };
          },
        },
      );
      const face = controller.inject();
      const page = forms.configForms.whileServed([SESSION_MODE_NS], () =>
        forms.slots.inject("plugins.row.config", () =>
          forms.slots.register(
            {
              name: "plugins.row.config",
              key: SESSION_MODE_ROW_CONFIG_KEY,
              // 文案经我们自己的注入面传：keyed 槽的注册项不带 `locale` 声明，不赌页面一定注入字典。
              inject: () => ({ ...face, t }),
            },
            ModelDefaultsCard,
          ),
        ),
      );
      return () => {
        page();
        controller.dispose();
      };
    }, "session-mode: settings card");
  });
}

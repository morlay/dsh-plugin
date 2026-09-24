/**
 * client 半：会话里的两个面（模式 chip 与头部标签）+ 设置页里那张「会话模式」卡片。
 *
 * | 槽位                                     | 呈现                                          |
 * | ---------------------------------------- | --------------------------------------------- |
 * | `conversation.hero.agentPreset`          | 新会话屏幕的顶部占位——chip 点开就是切换列表   |
 * | `conversation.session.header.actions`    | 会话头部的只读模式标签（`order: -10`，贴标题） |
 *
 * 官方的 `@deepseek-ai/dsh-client-ui-agent-preset` 在装配里被禁用（它同时带来设置页那块 roster 面板），
 * 所以这两个面归我们。
 *
 * 本行的配置页（各模式的默认模型 `config.models`）不再由本包画：那个字段是 volatile 的，页面由
 * `@morlay/dsh-client-ui-schema-form` 按 schema 自动生成（它注册到本行的配置入口 `plugins.row.config`，
 * key = `<bundle 包名>#<行 id>`）。本包只管会话里的两个面。
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only：`ctx.remote` 的合并面（选模型的候选来自 LLM 目录）。
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";

// Type-only：槽位声明与 standard props（session / session-maybe / global）。
import type {} from "@morlay/dsh-client-ui-conversation/client";
import { SessionModeLabel } from "./SessionModeLabel.tsx";
import { SessionModeSeat } from "./SessionModeSeat.tsx";
import { en, zh, type SessionModeLocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 会话里两个面的文案（配置页文案在通用 schema 表单的字典里）。 */
    "session-mode": SessionModeLocaleKey;
  }
}

/** 浏览器半插件的字典命名空间。 */
const NS = "session-mode";

/** 这一行里需要中文文案的字段（都在 `models.<模式>` 里，所以按模板路径注册一次）。 */
const FIELDS = ["provider", "model", "reasoningEffort"] as const;

/** 动态键的占位段（与通用表单的字段树同一约定）。 */
const DYNAMIC = "*";

/** 一个可配置 provider 的候选信息：显示名 + 它的配置在哪（模型清单从那份配置里读）。 */
interface ProviderEntry {
  value: string;
  label: string;
  settingsNs: string;
  settingsPath: readonly string[];
}

export type { SessionModeLabelProps } from "./SessionModeLabel.tsx";
export type { SessionModeSeatProps } from "./SessionModeSeat.tsx";
export type { SessionModeLocaleKey } from "./locales.ts";

/** 需要的服务：槽位与字典（会话列表经槽位的标准 props 到达组件，不必自己 inject）。 */
export const inject = ["slots", "locale"];

/** 本包 host 行 id：行配置页读的就是这个命名空间。 */
export const SESSION_MODE_NS = "session-mode";

/** 按路径读一段配置里的值（本包只读 provider 档案里的模型清单）。 */
function readAt(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, segment) => {
    if (Array.isArray(node)) return node[Number(segment)];
    if (typeof node !== "object" || node === null) return undefined;
    return Reflect.get(node, segment);
  }, root);
}

/**
 * 装上会话里的两个面，以及本行配置页的字段文案。
 *
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-mode: dictionaries");

  // `models` 的候选键是模式清单的 id：清单就在**同一行**的 config 值里（`modes`），直接读它即可——同步、不依赖
  // HTTP，值一变就让表单重算候选行。
  // 提示面是行配置表单提供的服务：等它可用再注册（`ctx.get` 在它还没提供时拿不到，注册会被静静跳过）。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const hints = scope.schemaFormHints;
      const forms = scope.get("configForms")?.get<Record<string, unknown>>(SESSION_MODE_NS);
      let offKeys: (() => void) | undefined;
      let offForms: (() => void) | undefined;
      if (forms !== undefined) {
        offKeys = hints.suggestKeys(SESSION_MODE_NS, ["models"], () => {
          const modes = forms.getSnapshot().value?.["modes"];
          return modes !== null && typeof modes === "object" ? Object.keys(modes) : [];
        });
        offForms = forms.subscribe(() => {
          hints.refresh();
        });
      }
      return () => {
        offKeys?.();
        offForms?.();
      };
    }, "session-mode: model key hints"),
  );

  // 本行的配置页由通用 schema 表单按 volatile 字段生成；这里给 `models` 里的三个字段补中文标签与说明。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const hints = scope.schemaFormHints;
      const offs = FIELDS.map((key) =>
        hints.describe(SESSION_MODE_NS, ["models", DYNAMIC, key], () => ({
          label: t(key),
          hint: t(`${key}Hint` as "providerHint"),
        })),
      );
      return () => {
        for (const off of offs) off();
      };
    }, "session-mode: field wording"),
  );

  // 选模型的候选不在本行的 schema 里：provider 是部署里的 LLM 目录（活着的路由 + 可配置声明），模型清单读那份声明
  // 指向的配置（`settingsNs` / `settingsPath`）。目录异步取到后注册——注册本身就是一次变更通知。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const hints = scope.schemaFormHints;
      const remote = scope.get("remote");
      const forms = scope.get("configForms");
      if (remote === undefined || forms === undefined) return () => {};
      let providers: ProviderEntry[] = [];
      const load = async (): Promise<void> => {
        const [routes, directory] = await Promise.all([
          remote.llm.listProviders(),
          remote.llm.listConfigurableProviders(),
        ]);
        if (!routes.ok || !directory.ok) return;
        const merged = new Map<string, ProviderEntry>();
        for (const entry of directory.value) {
          merged.set(entry.provider, {
            value: entry.provider,
            label: entry.displayName,
            settingsNs: entry.settingsNs,
            settingsPath: [...entry.settingsPath],
          });
        }
        for (const route of routes.value) {
          if (!merged.has(route.id)) {
            merged.set(route.id, {
              value: route.id,
              label: route.name,
              settingsNs: "",
              settingsPath: [],
            });
          }
        }
        providers = [...merged.values()];
        hints.refresh();
      };
      const modelsOf = (provider: unknown): readonly { value: string }[] => {
        if (typeof provider !== "string") return [];
        const entry = providers.find((candidate) => candidate.value === provider);
        if (entry === undefined || entry.settingsNs === "") return [];
        const profile = readAt(forms.get(entry.settingsNs).getSnapshot().value, entry.settingsPath);
        const models =
          typeof profile === "object" && profile !== null
            ? Reflect.get(profile, "models")
            : undefined;
        if (!Array.isArray(models)) return [];
        return models.flatMap((model) => {
          const id =
            typeof model === "object" && model !== null ? Reflect.get(model, "id") : undefined;
          return typeof id === "string" ? [{ value: id }] : [];
        });
      };
      const offs = [
        // 两个具名源：schema 上 `role('select', { source })` 认领它们，本包因此不必知道行 id 与字段路径。
        hints.source("llm-providers", {
          options: () => providers.map((entry) => ({ value: entry.value, label: entry.label })),
        }),
        // 换服务商就换模型清单：依赖声明让表单在投影时按当前 provider 重算候选。
        hints.source("llm-models", {
          dependsOn: [["provider"]],
          options: (read) => modelsOf(read(["provider"])),
        }),
        remote.$on("llm/adapters-updated", () => {
          void load();
        }),
        remote.$on("settings/document-updated", () => {
          hints.refresh();
        }),
      ];
      void load();
      return () => {
        for (const off of offs) off();
      };
    }, "session-mode: model candidates"),
  );

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
}

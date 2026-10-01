// client 半：会话里那一个面（模式 chip，槽位 `conversation.input.left`，list + session scope）+ 配置页字段文案。
// 官方 `@deepseek-ai/dsh-client-ui-agent-preset` 保留（官方管"挂哪套行"，我们管"会话级扩展"，两套入口并存）；
// 本行的配置页由 `@morlay/dsh-client-ui-primitives` 按 schema 自动生成，key = `<bundle 包名>#<行 id>`。

import type { Context } from "@deepseek-ai/cordis";
// Type-only：`ctx.remote` 的合并面（选模型的候选来自 LLM 目录）。
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：槽位声明与 standard props（session / session-maybe / global）。
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { apply as installUiPrimitives } from "@morlay/dsh-client-ui-primitives/client";
import { POLICY_NAMES } from "../shared.ts";
import { SessionModeSeat } from "./SessionModeSeat.tsx";
import { en, zh, type SessionModeLocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    // 会话里两个面的文案（配置页文案在通用 schema 表单的字典里）。
    "session-mode": SessionModeLocaleKey;
  }
}

// 浏览器半插件的字典命名空间。
const NS = "session-mode";

// 这一行里需要中文文案的字段（都在 `modes.<模式>.defaultModel` 里，所以按模板路径注册一次）。
const FIELDS = ["provider", "model", "reasoningEffort"] as const;

// 两份 policy 名单的字段名（`modes.<模式>.<字段>`）：它们在 schema 上是**字符串数组**（`z.array(z.string())`，没有
// enum），候选值由本文件登记的封闭名单 `POLICY_NAMES` 给（见下面 `hints.select` 那一段）——所以两条已知 policy
// 都以"未配置"的形态各占一项可选，页面把每一项画成选择器。
const POLICY_FIELDS = ["allowPolicies", "denyPolicies"] as const;

// 动态键的占位段（与通用表单的字段树同一约定）。
const DYNAMIC = "*";

// 一个可配置 provider 的候选信息：显示名 + 它的配置在哪（模型清单从那份配置里读）。
interface ProviderEntry {
  value: string;
  label: string;
  settingsNs: string;
  settingsPath: readonly string[];
}

export type { SessionModeSeatProps } from "./SessionModeSeat.tsx";
export type { SessionModeLocaleKey } from "./locales.ts";

// 需要的服务：槽位与字典（会话列表经槽位的标准 props 到达组件，不必自己 inject）。
export const inject = ["slots", "locale"];

// 本包 host 行 id：行配置页读的就是这个命名空间。
export const SESSION_MODE_NS = "session-mode";

// 按路径读一段配置里的值（本包只读 provider 档案里的模型清单）。
function readAt(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, segment) => {
    if (Array.isArray(node)) return node[Number(segment)];
    if (typeof node !== "object" || node === null) return undefined;
    return Reflect.get(node, segment);
  }, root);
}

// 装上会话里的那一个面，以及本行配置页的字段文案。
export function apply(ctx: Context): void {
  // 基础面随本包 inline（不再是装配行）：装上它提供的字典、字段槽与按行配置页；多份副本只装一次。
  installUiPrimitives(ctx);
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-mode: dictionaries");

  // 本行的配置页由通用 schema 表单按 volatile 字段生成；这里给 `modes.<模式>.defaultModel` 里的三个字段补
  // 中文标签与说明。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const hints = scope.schemaFormHints;
      const offs = FIELDS.map((key) =>
        hints.describe(SESSION_MODE_NS, ["modes", DYNAMIC, "defaultModel", key], () => ({
          label: t(key),
          hint: t(`${key}Hint` as "providerHint"),
        })),
      );
      return () => {
        for (const off of offs) off();
      };
    }, "session-mode: field wording"),
  );

  // 两份 policy 名单是**字符串数组**，键的候选是一份封闭名单（上游 waterfall 名，见 `shared.ts` 的
  // `POLICY_NAMES`）：在数组**项**那一路径上登记候选值，页面因此把每一项画成选择器，两条已知 policy 直接可选
  // （不必手写名字）。名单住在 `shared.ts`——client 半不 import `modes.ts`（免得把 schemastery 拖进浏览器包）。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const offs = POLICY_FIELDS.map((key) =>
        scope.schemaFormHints.select(SESSION_MODE_NS, ["modes", DYNAMIC, key, DYNAMIC], {
          options: () => POLICY_NAMES.map((value) => ({ value })),
        }),
      );
      return () => {
        for (const off of offs) off();
      };
    }, "session-mode: policy candidates"),
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

  // chip 挂 **composer 工具行左侧**（`conversation.input.left`，list + session scope）：新会话屏也是一个
  // blank session 的 composer，所以那里也能选模式——头部槽位在新会话屏不存在。
  ctx.inject(["slots", "conversation"], (scope) => {
    scope.effect(() => {
      const seat = scope.slots.register(
        {
          name: "conversation.input.left",
          id: "session-mode",
          order: 0,
          locale: NS,
        },
        SessionModeSeat,
      );
      return () => {
        seat();
      };
    }, "session-mode: composer chip");
  });
}

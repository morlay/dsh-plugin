// client 半：会话里那一个面（模式 chip，槽位 `conversation.input.left`，list + session scope）+ 配置面两处——
// 本行自己那页（由 `@morlay/dsh-client-ui-primitives` 按 schema 自动生成，key = `<bundle 包名>#<行 id>`）与
// 装本行的 bundle 那一页（`plugins.bundle.config`，key = bundle 包名，见 `./BundleConfigPage.tsx`）。

import type { Context } from "@deepseek-ai/cordis";
// Type-only：`ctx.remote` 的合并面（选模型的候选来自 LLM 目录）。
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：槽位声明与 standard props（session / session-maybe / global）。
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
// Type-only：`plugins.bundle.config` 的槽位声明（bundle 详情页的配置座位）。
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import { apply as installUiPrimitives } from "@morlay/dsh-client-ui-primitives/client";
import { POLICY_NAMES } from "../shared.ts";
import {
  BUNDLE_CONFIG_KEY,
  createBundleConfigFace,
  SESSION_MODE_NS,
  unwrapService,
  type HintsLike,
  type HintsService,
} from "./bundle-config.ts";
import { BundleConfigPage } from "./BundleConfigPage.tsx";
import { BUNDLE_NS, bundleEn, bundleZh, type BundleLocaleKey } from "./bundle-locales.ts";
import { SessionModeSeat } from "./SessionModeSeat.tsx";
import { en, zh, type SessionModeLocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    // 会话里两个面的文案（本行配置页的文案在通用 schema 表单的字典里）。
    "session-mode": SessionModeLocaleKey;
    // bundle 配置页（`plugins.bundle.config`）的文案。
    "session-mode-bundle": BundleLocaleKey;
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

// 客户端 remote 的一个命名空间：gateway 的 client 半把每个命名空间注册成**独立服务**（服务名
// `remote.<命名空间>`），**不是** `remote` 服务上的属性——所以按服务名取（属性访问读不到）。
// 部署里可能没有这个命名空间（headless 没装 preset registry），读不到就按"没有候选"处理。
function remoteNamespace<T>(scope: Context, namespace: string): T | undefined {
  try {
    return (scope as unknown as { get(key: string): unknown }).get(`remote.${namespace}`) as
      | T
      | undefined;
  } catch {
    // 服务没注册时 `ctx.get` 抛错：按"这个命名空间不在这一版部署里"处理。
    return undefined;
  }
}

// 部署里的 agent preset 清单（`remote.agentPresets.list()`）：本包只用它的 id 与显示名做候选。
interface PresetRosterReader {
  list: () => Promise<
    | { ok: true; value: { presets: readonly { id: string; name?: string }[] } }
    | { ok: false }
  >;
}

// 本包从 LLM 命名空间读的那两件事（活着的路由清单与可配置声明）。
interface LlmReader {
  listProviders: () => Promise<
    { ok: true; value: readonly { id: string; name: string }[] } | { ok: false }
  >;
  listConfigurableProviders: () => Promise<
    | {
        ok: true;
        value: readonly {
          provider: string;
          displayName: string;
          settingsNs: string;
          settingsPath: readonly string[];
        }[];
      }
    | { ok: false }
  >;
}

// 一个可配置 provider 的候选信息：显示名 + 它的配置在哪（模型清单从那份配置里读）。
interface ProviderEntry {
  value: string;
  label: string;
  settingsNs: string;
  settingsPath: readonly string[];
}

// 一个可配置 provider 的候选信息：显示名 + 它的配置在哪（模型清单从那份配置里读）。
interface ProviderEntry {
  value: string;
  label: string;
  settingsNs: string;
  settingsPath: readonly string[];
}


export type { SessionModeSeatProps } from "./SessionModeSeat.tsx";
export type { SessionModeLocaleKey } from "./locales.ts";
export type { BundleConfigPageProps } from "./BundleConfigPage.tsx";

// 需要的服务：槽位与字典（会话列表经槽位的标准 props 到达组件，不必自己 inject）；bundle 那页另要配置表单与
// schema 服务，见下面那段注册自己的 `ctx.inject`。
export const inject = ["slots", "locale"];

// 本包 host 行 id：行配置页与 bundle 配置页读的都是这个命名空间。
export { SESSION_MODE_NS };

// 按路径读一段配置里的值（本包只读 provider 档案里的模型清单）。
function readAt(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, segment) => {
    if (Array.isArray(node)) return node[Number(segment)];
    if (typeof node !== "object" || node === null) return undefined;
    return Reflect.get(node, segment);
  }, root);
}

// 从 inject 的 scope 上取提示面服务并解包：cordis 把它包成追踪代理，而它的实现用的是 JS 私有字段，
// 代理上的方法调用会以代理为 `this` 而抛（`Cannot read private member #texts …`）。
function unwrapHintService(scope: Context): HintsService {
  return unwrapService(scope.schemaFormHints as unknown as HintsService) as HintsService;
}

// 装上会话里的那一个面、本行配置页的字段文案，以及装本行的 bundle 那一页的表单。
export function apply(ctx: Context): void {
  // 基础面随本包 inline（不再是装配行）：装上它提供的字典、字段槽与按行配置页；多份副本只装一次。
  installUiPrimitives(ctx);
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-mode: dictionaries");

  // 本行的配置页由通用 schema 表单按 volatile 字段生成；这里给 `modes.<模式>.defaultModel` 里的三个字段补
  // 中文标签与说明。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      // 提示面服务走 cordis 的追踪代理，而它的实现用 JS 私有字段：先解包成原实例再调（见 `./bundle-config.ts`）。
      const hints = unwrapHintService(scope);
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
        unwrapHintService(scope).select(SESSION_MODE_NS, ["modes", DYNAMIC, key, DYNAMIC], {
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
      const hints = unwrapHintService(scope);
      const remote = scope.get("remote");
      const llm = remoteNamespace<LlmReader>(scope, "llm");
      const forms = scope.get("configForms");
      if (remote === undefined || llm === undefined || forms === undefined) return () => {};
      let providers: ProviderEntry[] = [];
      const load = async (): Promise<void> => {
        const [routes, directory] = await Promise.all([
          llm.listProviders(),
          llm.listConfigurableProviders(),
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


  // 模式"允许挂哪些 preset"的候选：部署里注册的 agent preset（`remote.agentPresets.list()`），登记成具名源
  // `agent-presets`——schema 上 `presetsOnly` 声明 `role('select', { source })` 认领它，页面不必知道这些 preset
  // 从哪来。装配组合变了（设置文档一次更新）就重取一次。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const hints = unwrapHintService(scope);
      const remote = scope.get("remote");
      if (remote === undefined) return () => {};
      const roster = remoteNamespace<PresetRosterReader>(scope, "agentPresets");
      if (roster === undefined) return () => {};
      let presets: readonly { value: string; label: string }[] = [];
      const load = async (): Promise<void> => {
        const listed = await roster.list();
        if (!listed.ok) return;
        presets = listed.value.presets.map((preset) => ({
          value: preset.id,
          label: preset.name ?? preset.id,
        }));
        // 候选变了：注册本身就是一次变更通知（页面据此重投影）。
        hints.refresh();
      };
      const offs = [
        hints.source("agent-presets", { options: () => presets }),
        remote.$on("settings/document-updated", () => {
          void load();
        }),
      ];
      void load();
      return () => {
        for (const off of offs) off();
      };
    }, "session-mode: preset candidates"),
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

  // 装本行的 bundle 那一页（`plugins.bundle.config`，key = bundle 包名）：本行是那份配置的 owner，页面摆的就是
  // `modes` 与 `default` 这几项——按模式折叠分组而不是按 schema 平铺，所以它自带表单，不用自动生成那页。
  // 提示面的候选（选服务商 / 选模型的两个具名源）可能比本页晚到，所以这一页自己重投影的入口留在外面：
  // 提示面一到（或它的候选变了）就刷一次，模型那两个字段不会静默退回手输。
  let refreshPage: (() => void) | undefined;
  // 提示面按**属性访问**取（`ctx.get(name)` 给的是追踪代理，调带 JS 私有字段的方法会抛），存下来给下面那一页用。
  let hints: HintsLike | undefined;
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      // 订阅也要用解包后的实例（服务实现用 JS 私有字段，代理上的调用会抛）。
      const service = unwrapHintService(scope);
      hints = service;
      const off = service.subscribe(() => {
        refreshPage?.();
      });
      return () => {
        off();
        hints = undefined;
      };
    }, "session-mode: bundle page candidates"),
  );

  ctx.inject(["slots", "locale", "configForms", "settingsSchema"], (scope) => {
    scope.effect(() => {
      const bundleT = scope.locale.bind(BUNDLE_NS);
      const { face, refresh, dispose } = createBundleConfigFace(scope, bundleT, () => hints);
      refreshPage = refresh;
      const bundleDictionary = scope.locale.register(BUNDLE_NS, { zh: bundleZh, en: bundleEn });
      const off = scope.slots.inject("plugins.bundle.config", () =>
        scope.slots.register(
          {
            name: "plugins.bundle.config",
            key: BUNDLE_CONFIG_KEY,
            locale: BUNDLE_NS,
            inject: () => face,
          },
          BundleConfigPage,
        ),
      );
      return () => {
        off();
        bundleDictionary();
        refreshPage = undefined;
        dispose();
      };
    }, "session-mode: bundle configuration page");
  });
}

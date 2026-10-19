// client 半的 Provider 形态：会话里那一个面（模式 chip，槽位 `conversation.input.left`，list + session scope）
// + 配置面两处——本行自己那页（由 `@morlay/dsh-client-ui-primitives` 按 schema 自动生成，key =
// `<bundle 包名>#<行 id>`）与装本行的 bundle 那一页（`plugins.bundle.config`，key = bundle 包名，见
// `./BundleConfigPage.tsx`）。
//
// 依赖用字段 `inject(...)` 声明：稳定服务走领域令牌，可选服务缺席时安静跳过；装配入口见 `./index.ts` 的
// `toCordis(SessionModeClient)`。

import type { ClientRemote } from "@deepseek-ai/dsh-api-remotes/client";
import { ConfigForms, SchemaFormHints, SettingsSchema } from "@morlay/dsh-web-app/settings/client/tokens";
import { Locale } from "@morlay/dsh-web-app/locale/client/tokens";
import { Remote } from "@morlay/dsh-web-app/api-remotes/client/tokens";
import { Slots, type SlotsLike } from "@morlay/dsh-web-app/renderer/client/tokens";
import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";
// Type-only：槽位声明与 standard props（session / session-maybe / global）。
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
// Type-only：`plugins.bundle.config` 的槽位声明（bundle 详情页的配置座位）。
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {
  ConfigForms as ConfigFormsService,
  SettingsSchemaService,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import { Injectable, inject, providerContext, type Context } from "@morlay/zephyr";
import {
  CATALOG_NS,
  SESSION_MODE_CATALOG_REMOTE,
  type SessionModeCatalogRemote,
} from "../catalog-remote.ts";
import { POLICY_NAMES } from "../shared.ts";
import {
  BUNDLE_CONFIG_KEY,
  createBundleConfigFace,
  SESSION_MODE_NS,
  unwrapService,
} from "./bundle-config.ts";
import { BundleConfigPage } from "./BundleConfigPage.tsx";
import { BUNDLE_NS, bundleEn, bundleZh } from "./bundle-locales.ts";
import { loadLlmProviders, remoteNamespace, type ProviderModels } from "./llm-directory.ts";
import { SessionModeSeat } from "./SessionModeSeat.tsx";
import { en, zh } from "./locales.ts";

// 浏览器半插件的字典命名空间。
export const NS = "session-mode";

// 本包 host 行 id：行配置页与 bundle 配置页读的都是这个命名空间。
export { SESSION_MODE_NS };

// 这一行里需要中文文案的字段（都在 `modes.<模式>.defaultModel` 里，所以按模板路径注册一次）。
const FIELDS = ["provider", "model", "reasoningEffort"] as const;

// 两份 policy 名单的字段名（`modes.<模式>.<字段>`）：它们在 schema 上是**字符串数组**（`z.array(z.string())`，没有
// enum），候选值由本文件登记的封闭名单 `POLICY_NAMES` 给（见下面 `hints.select` 那一段）——所以两条已知 policy
// 都以"未配置"的形态各占一项可选，页面把每一项画成选择器。
const POLICY_FIELDS = ["allowPolicies", "denyPolicies"] as const;

// 动态键的占位段（与通用表单的字段树同一约定）。
const DYNAMIC = "*";

// 部署里的 agent preset 清单（`remote.agentPresets.list()`）：本包只用它的 id 与显示名做候选。
interface PresetRosterReader {
  list: () => Promise<
    { ok: true; value: { presets: readonly { id: string; name?: string }[] } } | { ok: false }
  >;
}

// Provider 内部函数（配置页 / LLM 目录 / 目录命名空间）需要的 ctx 面：只由注入字段组成，
// 不把整只 Context 传下去，也不回退到字符串 inject。
export interface SessionModeScope {
  readonly locale: LocaleRuntime;
  readonly slots: SlotsLike;
  readonly remote: ClientRemote | undefined;
  readonly configForms: ConfigFormsService | undefined;
  readonly settingsSchema: SettingsSchemaService | undefined;
  get(name: string): unknown;
}

// 装上会话里的那一个面、本行配置页的字段文案，以及装本行的 bundle 那一页的表单。
@Injectable()
export class SessionModeClient {
  locale = inject(Locale);

  slots = inject(Slots);

  // 老组合没有提示面：缺席就安静跳过。
  hints = inject.optional(SchemaFormHints);

  // `remote` 不是每个环境都有（测试替身、极简装配）：没有就只保留不依赖目录的候选。
  remote = inject.optional(Remote);

  // bundle 那页另要配置表单与 schema 服务：缺席时整页不注册。
  configForms = inject.optional(ConfigForms);

  settingsSchema = inject.optional(SettingsSchema);

  onInit(ctx: Context): void {
    const fullCtx = providerContext(ctx);
    const scope: SessionModeScope = {
      locale: this.locale,
      slots: this.slots,
      remote: this.remote,
      configForms: this.configForms,
      settingsSchema: this.settingsSchema,
      get: (name) => fullCtx.get(name),
    };

    // 基础面（内联库）由 `@morlay/dsh-client-modules` 的 client 行统一装配；这里只注册本行的字段文案。
    const t = scope.locale.bind(NS);
    ctx.effect(() => scope.locale.register(NS, { zh, en }), "session-mode: dictionaries");

    // 提示面服务走 cordis 的追踪代理，而它的实现可能用 JS 私有字段：先解包成原实例再调（见 `./bundle-config.ts`）。
    const hints = unwrapService(this.hints);

    if (hints !== undefined) {
      // 本行的配置页由通用 schema 表单按 volatile 字段生成；这里给 `modes.<模式>.defaultModel` 里的三个字段补
      // 中文标签与说明。
      ctx.effect(() => {
        const offs = FIELDS.map((key) =>
          hints.describe(SESSION_MODE_NS, ["modes", DYNAMIC, "defaultModel", key], () => ({
            label: t(key),
            hint: t(`${key}Hint` as "providerHint"),
          })),
        );
        return () => {
          for (const off of offs) off();
        };
      }, "session-mode: field wording");

      // 两份 policy 名单是**字符串数组**，键的候选是一份封闭名单（上游 waterfall 名，见 `shared.ts` 的
      // `POLICY_NAMES`）：在数组**项**那一路径上登记候选值，页面因此把每一项画成选择器，两条已知 policy 直接可选
      // （不必手写名字）。名单住在 `shared.ts`——client 半不 import `modes.ts`（免得把 schemastery 拖进浏览器包）。
      ctx.effect(() => {
        const offs = POLICY_FIELDS.map((key) =>
          hints.select(SESSION_MODE_NS, ["modes", DYNAMIC, key, DYNAMIC], {
            options: () => POLICY_NAMES.map((value) => ({ value })),
          }),
        );
        return () => {
          for (const off of offs) off();
        };
      }, "session-mode: policy candidates");
    }

    const remote = scope.remote;
    if (hints !== undefined && remote !== undefined) {
      // 选模型的候选不在本行的 schema 里：读的是部署里的 LLM 目录（活着的路由 + 可配置声明，模型清单在声明指向的
      // 配置里，见 `./llm-directory.ts`）。目录异步取到后注册——注册本身就是一次变更通知。
      ctx.effect(() => {
        let providers: readonly ProviderModels[] = [];
        const load = async (): Promise<void> => {
          providers = await loadLlmProviders(scope);
          hints.refresh();
        };
        const offs = [
          // 两个具名源：schema 上 `role('select', { source })` 认领它们，本包因此不必知道行 id 与字段路径。
          hints.source("llm-providers", {
            options: () => providers.map((entry) => ({ value: entry.value, label: entry.label })),
          }),
          // 换服务商就换模型清单：依赖声明让表单在投影时按当前 provider 重算候选。
          hints.source("llm-models", {
            dependsOn: [["provider"]],
            options: (read: (path: readonly string[]) => unknown) => {
              const provider = read(["provider"]);
              return typeof provider === "string"
                ? (providers.find((entry) => entry.value === provider)?.models ?? [])
                : [];
            },
          }),
          remote.$on("llm/adapters-updated", () => {
            void load();
          }),
          remote.$on("settings/document-updated", () => {
            void load();
          }),
        ];
        void load();
        return () => {
          for (const off of offs) off();
        };
      }, "session-mode: model candidates");

      // 模式"允许挂哪些 preset"的候选：部署里注册的 agent preset（`remote.agentPresets.list()`），登记成具名源
      // `agent-presets`——schema 上 `presetsOnly` 声明 `role('select', { source })` 认领它，页面不必知道这些 preset
      // 从哪来。装配组合变了（设置文档一次更新）就重取一次。
      ctx.effect(() => {
        let presets: readonly { value: string; label: string }[] = [];
        const roster = remoteNamespace<PresetRosterReader>(scope, "agentPresets");
        if (roster === undefined) return () => {};
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
      }, "session-mode: preset candidates");

      // 配置页的名单候选（工具名 / 技能名 / 上游 policy 名）：前两个来自本包自己开的那条 Remote 面
      // （`../catalog-remote.ts`——工具清单只在 host，技能面按会话，配置页都没有别的路可走），mount 由这里做；
      // policy 名是一份封闭名单（`shared.ts`）。三个都是**具名源**，schema 上名单字段声明 `role('select', { source })`
      // 认领——标签输入因此聚焦就有候选，而不是只能手输。
      ctx.effect(() => {
        let tools: readonly string[] = [];
        let skills: readonly string[] = [];
        const offs = [
          hints.source("catalog-tools", { options: () => tools.map((value) => ({ value })) }),
          hints.source("catalog-skills", { options: () => skills.map((value) => ({ value })) }),
          hints.source("policies", { options: () => POLICY_NAMES.map((value) => ({ value })) }),
        ];
        let disposeMount: (() => Promise<void>) | undefined;
        // `$mount` 不是每个环境都有（测试替身、极简装配）：没有就只留 policy 那份候选。
        if (typeof remote.$mount !== "function") {
          return () => {
            for (const off of offs) off();
          };
        }
        void remote
          .$mount(SESSION_MODE_CATALOG_REMOTE)
          .then(async (dispose: () => Promise<void>) => {
            disposeMount = dispose;
            const listed = await remoteNamespace<SessionModeCatalogRemote>(
              scope,
              CATALOG_NS,
            )?.list();
            if (listed?.ok !== true) return;
            tools = listed.value.tools;
            skills = listed.value.skills;
            hints.refresh();
          })
          .catch(() => {
            // 这条面 mount 不上（旧 host）时不给候选：字段退回自由输入，不炸页面。
          });
        return () => {
          for (const off of offs) off();
          void disposeMount?.();
        };
      }, "session-mode: catalog candidates");
    }

    // chip 挂 **composer 工具行左侧**（`conversation.input.left`，list + session scope）：新会话屏也是一个
    // blank session 的 composer，所以那里也能选模式——头部槽位在新会话屏不存在。`slots.inject` 等的是槽位声明
    // 本身（而不是某个业务服务），贡献随本行卸载一起收回。
    ctx.effect(
      () =>
        scope.slots.inject("conversation.input.left", () =>
          scope.slots.register(
            {
              name: "conversation.input.left",
              id: "session-mode",
              order: 0,
              locale: NS,
            },
            SessionModeSeat,
          ),
        ),
      "session-mode: composer chip",
    );

    // 装本行的 bundle 那一页（`plugins.bundle.config`，key = bundle 包名）：本行是那份配置的 owner，页面摆的就是
    // `modes` 与 `default` 这几项——按模式折叠分组而不是按 schema 平铺，所以它自带表单，不用自动生成那页。
    // 提示面的候选（选服务商 / 选模型的两个具名源）可能比本页晚到，所以这一页自己重投影的入口留在外面：
    // 提示面一到（或它的候选变了）就刷一次，模型那两个字段不会静默退回手输。
    let refreshPage: (() => void) | undefined;
    if (hints !== undefined) {
      ctx.effect(() => {
        // 订阅也要用解包后的实例（服务实现可能用 JS 私有字段，代理上的调用会抛）。
        const off = hints.subscribe(() => {
          refreshPage?.();
        });
        return () => {
          off();
        };
      }, "session-mode: bundle page candidates");
    }

    const configForms = scope.configForms;
    const settingsSchema = scope.settingsSchema;
    if (configForms !== undefined && settingsSchema !== undefined) {
      const bundleScope = { ...scope, configForms, settingsSchema };
      ctx.effect(() => {
        const bundleT = bundleScope.locale.bind(BUNDLE_NS);
        const { face, refresh, dispose } = createBundleConfigFace(
          bundleScope,
          bundleT,
          () => hints,
        );
        refreshPage = refresh;
        const bundleDictionary = bundleScope.locale.register(BUNDLE_NS, {
          zh: bundleZh,
          en: bundleEn,
        });
        const off = bundleScope.slots.inject("plugins.bundle.config", () =>
          bundleScope.slots.register(
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
    }
  }
}

// client 半：会话里那一个面（模式 chip，槽位 `conversation.input.left`，list + session scope）。bundle 配置页
// 不再注册——模式与它的生效面（工具 / 技能 / policy / 系统提示词）改在侧边栏面板里按会话展示。

import type { Context } from "@deepseek-ai/cordis";
// Type-only：`ctx.remote` 的合并面（选模型的候选来自 LLM 目录）。
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：槽位声明与 standard props（session / session-maybe / global）。
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
// Type-only：`plugins.bundle.config` 的槽位声明（bundle 详情页的配置座位）。
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
// Type-only：右栏 tab 的类型注册面（`ctx.sidebarRightTabs`）与座位声明。
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import {
  CATALOG_NS,
  SESSION_MODE_CATALOG_REMOTE,
  type SessionModeCatalogRemote,
} from "../catalog-remote.ts";
import { POLICY_NAMES } from "../shared.ts";
import { SESSION_MODE_NS, unwrapService, type HintsService } from "./hints.ts";
import { loadLlmProviders, remoteNamespace, type ProviderModels } from "./llm-directory.ts";
import { SessionModePanel } from "./SessionModePanel.tsx";
import { SessionModeSeat } from "./SessionModeSeat.tsx";
import { en, zh, type SessionModeLocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    // 会话里那个面（模式 chip）的文案。
    "session-mode": SessionModeLocaleKey;
    // bundle 配置页的字典：页面已不再注册，类型面留着给保留的文件。
    "session-mode-bundle": import("./bundle-locales.ts").BundleLocaleKey;
  }
}

// 浏览器半插件的字典命名空间。
const NS = "session-mode";

// 右栏 tab 类型的 id（也是正文座位的 key）：包名是天然的唯一值。
const PANEL_ID = "@morlay/dsh-session-mode";

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

export type { SessionModeSeatProps } from "./SessionModeSeat.tsx";
export type { SessionModeLocaleKey } from "./locales.ts";

// 需要的服务：槽位与字典（会话列表经槽位的标准 props 到达组件，不必自己 inject）；bundle 那页另要配置表单与
// schema 服务，见下面那段注册自己的 `ctx.inject`。
export const inject = ["slots", "locale"];

// 本包 host 行 id：行配置页与 bundle 配置页读的都是这个命名空间。
export { SESSION_MODE_NS };

// 从 inject 的 scope 上取提示面服务并解包：cordis 把它包成追踪代理，而它的实现用的是 JS 私有字段，
// 代理上的方法调用会以代理为 `this` 而抛（`Cannot read private member #texts …`）。
function unwrapHintService(scope: Context): HintsService {
  return unwrapService(scope.schemaFormHints as unknown as HintsService) as HintsService;
}

// 装上会话里的那一个面、本行配置页的字段文案，以及装本行的 bundle 那一页的表单。
export function apply(ctx: Context): void {
  // 基础面（内联库）由 `@morlay/dsh-client-modules` 的 client 行统一装配；这里只注册本行的字段文案。
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

  // 选模型的候选不在本行的 schema 里：读的是部署里的 LLM 目录（活着的路由 + 可配置声明，模型清单在声明指向的
  // 配置里，见 `./llm-directory.ts`）。目录异步取到后注册——注册本身就是一次变更通知。
  ctx.inject(["schemaFormHints"], (scope) =>
    scope.effect(() => {
      const hints = unwrapHintService(scope);
      const remote = scope.get("remote");
      if (remote === undefined) return () => {};
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
          options: (read) => {
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

  // 配置页的名单候选（工具名 / 技能名 / 上游 policy 名）：前两个来自本包自己开的那条 Remote 面
  // （`../catalog-remote.ts`——工具清单只在 host，技能面按会话，配置页都没有别的路可走），mount 由这里做；
  // policy 名是一份封闭名单（`shared.ts`）。三个都是**具名源**，schema 上名单字段声明 `role('select', { source })`
  // 认领——标签输入因此聚焦就有候选，而不是只能手输。
  ctx.inject(["schemaFormHints", "remote"], (scope) =>
    scope.effect(() => {
      const hints = unwrapHintService(scope);
      let tools: readonly string[] = [];
      let skills: readonly string[] = [];
      const offs = [
        hints.source("catalog-tools", { options: () => tools.map((value) => ({ value })) }),
        hints.source("catalog-skills", { options: () => skills.map((value) => ({ value })) }),
        hints.source("policies", { options: () => POLICY_NAMES.map((value) => ({ value })) }),
      ];
      let disposeMount: (() => Promise<void>) | undefined;
      // `$mount` 不是每个环境都有（测试替身、极简装配）：没有就只留 policy 那份候选。
      if (typeof scope.remote.$mount !== "function") {
        return () => {
          for (const off of offs) off();
        };
      }
      void scope.remote
        .$mount(SESSION_MODE_CATALOG_REMOTE)
        .then(async (dispose: () => Promise<void>) => {
          disposeMount = dispose;
          const listed = await remoteNamespace<SessionModeCatalogRemote>(scope, CATALOG_NS)?.list();
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
    }, "session-mode: catalog candidates"),
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

  // 右栏面板（`sidebar.right.pane.tab`）：只展示这个会话**选中的模式**与它当下生效的那一份。注册是两段式——
  // 类型进 `sidebarRightTabs`，正文进 keyed 座位（key = 类型 id）——与上游各 tab 类型走同一条路。
  ctx.inject(["sidebarRightTabs", "slots", "locale"], (scope) =>
    scope.effect(() => {
      const panelT = scope.locale.bind(NS);
      const offType = scope.sidebarRightTabs.register({
        id: PANEL_ID,
        kind: PANEL_ID,
        priority: "extension",
        title: () => panelT("panel"),
        // 右栏 guide 页上的一条入口：没有它，用户只能等自动打开才看得到这一页。
        guide: [
          {
            id: PANEL_ID,
            order: 20,
            title: () => panelT("panel"),
            description: () => panelT("panelDescription"),
          },
        ],
      });
      const body = scope.slots.inject("sidebar.right.pane.tab", () =>
        scope.slots.register(
          { name: "sidebar.right.pane.tab", key: PANEL_ID, locale: NS },
          SessionModePanel,
        ),
      );
      return () => {
        body();
        offType();
      };
    }, "session-mode: sidebar panel"),
  );

  // 和新建对话联动：当前会话一变（新建或切换）就把面板带到右栏。右栏没挂载（窄屏/未装那一行）时不动；
  // 同一 pane 内按 kind 单页，重复调用只是把已有那一页选中。
  ctx.inject(["sidebarRight", "uiSession"], (scope) =>
    scope.effect(() => {
      const current = scope.uiSession.adapter.current;
      // `mounted` 是右栏当前显示的会话：首帧与切换过程中它还没指向新会话，这时 `openTab` 会以
      // "no session surface is mounted" 抛错。所以两路都订阅——会话换了自己不写，等右栏挂到这个会话
      // 再打开（同一 pane 内按 kind 单页，重复调用只是选中）。
      const mounted = scope.sidebarRight.mounted;
      let queued = false;
      const sync = (): void => {
        if (queued) return;
        queued = true;
        // 推迟到本轮订阅回调结束之后：`publishMain` 期间 surface 还在切换，同步写会抛。
        queueMicrotask(() => {
          queued = false;
          const key = current.getSnapshot().key;
          if (typeof key !== "string" || key.length === 0) return;
          if (mounted.getSnapshot() !== key) return;
          try {
            scope.sidebarRight.openTab(PANEL_ID);
          } catch {
            // 挂载与卸载之间仍可能撞上：下一次订阅回调会再试，这里不当作错误。
          }
        });
      };
      const offCurrent = current.subscribe(sync);
      const offMounted = mounted.subscribe(sync);
      sync();
      return () => {
        offCurrent();
        offMounted();
      };
    }, "session-mode: panel follows the session"),
  );
}

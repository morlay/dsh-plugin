/**
 * client 半：为每个可由 schema 生成配置页的行注册本行的配置入口，并给出字段级自定义输入的槽契约。
 *
 * | 面                                   | 呈现                                                             |
 * | ------------------------------------ | ---------------------------------------------------------------- |
 * | `plugins.row.config`（key 见 `rows.ts`） | `view: 'page'` 渲染该行 schema 生成的表单；`summary` 不画东西     |
 * | Factory `settings.schema-form.form`  | 行注册项经它渲染同一份表单体，字段槽因此只声明一次               |
 * | `settings.schema-form.field`         | chain 槽：业务方按 `role` 或 `ns + path` 认领字段的控件与文案    |
 *
 * 数据面是 host 的 settings 投影与共享配置表单（`ctx.configForms` / `ctx.settingsSchema`）；bundle 与行的对应关系
 * 来自 `remote.pluginManager.listBundles()`。手写卡片用默认 priority 0 注册，按 slots 的 cell winner 规则自然遮住
 * 这里的自动项，因此两种页面可以并存、迁移不必一次做完。
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-api-remotes/types";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { PropsRenderFactories, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import { SchemaFormController, canRender, type SchemaFormFace } from "./controller.ts";
import { SchemaFormHints } from "./hints.ts";
import { en, zh } from "./locales.ts";
import { RowRegistration } from "./rows.ts";
import { SchemaForm } from "./SchemaForm.tsx";
import type { SchemaFormProps } from "./slot-contract.ts";

/** 本包字典与槽位文案的命名空间。 */
export const NS = "settings.schema-form";

/** 需要的服务：槽位、字典、共享配置表单、schema 服务与插件管理（bundle 行清单）。 */
export const inject = [
  "slots",
  "locale",
  "configForms",
  "settingsSchema",
  "remote",
  "remote.pluginManager",
];

export type {
  SchemaFieldComponentProps,
  SchemaFieldMatch,
  SchemaFieldOwnerProps,
  SchemaFieldSelect,
  SchemaFormProps,
} from "./slot-contract.ts";
export type { SchemaFormActions, SchemaFormFace, SchemaFormState } from "./controller.ts";
export type { FieldNode, FieldMeta, WalkedField } from "./schema-node.ts";
export type { SchemaFormLocaleKey } from "./locales.ts";
export type { RowRegistrationPlan } from "./rows.ts";
export { rowRegistrations } from "./rows.ts";
export { SchemaFieldDefault, InlineValue, tokenText, tokenTone, valueText } from "./value.tsx";
export { parseFor } from "./fields.tsx";
export { containerShape, editorLines, visibleFields } from "./lines.ts";
export type { EditorLine, FoldState } from "./lines.ts";
export { SchemaFormController, canRender, optionsFor, projectRoot } from "./controller.ts";
export { walkFields, projectNode } from "./schema-node.ts";
export { SchemaFormHints } from "./hints.ts";
export type {
  FieldText,
  SchemaFormHintsFace,
  SelectOption,
  SelectSpec,
  SuggestedKeysReader,
} from "./hints.ts";
export type { SuggestedKeys } from "./schema-node.ts";

/** 行配置入口的注册项：`page` 画表单，`summary` 不画（行的描述来自包自己的 locale）。 */
type RowConfigEntryProps = PropsRuntime<"plugins.row.config"> & PropsRenderFactories;

/**
 * 装上本包：字典、Factory（字段槽的声明者）与按行自动注册。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-schema-form: dictionaries");
  // 提示面（dict 的候选键）：同一次 apply 里提供，业务插件注册读数，本包的行投影读它。
  const hints = new SchemaFormHints(ctx);
  ctx.effect(
    () =>
      ctx.slots.registerFactory(
        {
          name: "settings.schema-form.form",
          scope: "root",
          children: { "settings.schema-form.field": { kind: "chain", scope: "root" } },
          locale: NS,
        },
        SchemaForm,
      ),
    "ui-schema-form: form factory",
  );

  const rehydrate = (serialized: unknown) => ctx.settingsSchema.rehydrate(serialized);
  const validate = (schema: Parameters<typeof ctx.settingsSchema.validate>[0], value: unknown) =>
    ctx.settingsSchema.validate(schema, value);
  const resolveText = (text: string | Readonly<Record<string, string>>): string =>
    typeof text === "string" ? text : ctx.locale.resolveText(text as never);

  const entries = new Map<
    string,
    { controller: SchemaFormController; face: SchemaFormFace; component: unknown }
  >();
  const entryFor = (ns: string): { component: unknown } | undefined => {
    const describe = ctx.configForms.describe();
    const view = describe.getSnapshot().view?.namespaces.find((row) => row.ns === ns);
    if (!canRender(view, rehydrate)) return undefined;
    const existing = entries.get(ns);
    if (existing !== undefined) return existing;
    const controller = new SchemaFormController(ns, {
      form: ctx.configForms.get(ns),
      describe,
      rehydrate,
      validate,
      t: ctx.locale.bind(NS),
      hints: {
        keysFor: (path) => hints.keysFor(ns, path),
        textFor: (path) => hints.textFor(ns, path),
        selectFor: (path) => hints.selectFor(ns, path),
      },
    });
    const face = controller.face();
    const props: SchemaFormProps = { ns, face, resolveText };
    const component = (entryProps: RowConfigEntryProps): ReactNode =>
      entryProps.view === "page"
        ? entryProps.renderFactorySlot("settings.schema-form.form", props)
        : null;
    const entry = { controller, face, component };
    entries.set(ns, entry);
    return entry;
  };

  const registration = new RowRegistration({
    // 槽位注册的 options 由 slots 的窄化签名收口；这里给的是它接受的同一形状（name/key/priority/locale）。
    slots: ctx.slots as never,
    describe: ctx.configForms.describe(),
    // 读不到 bundle 清单就什么都不注册（下一次 describe 变化或插件变更还会再来一遍）。
    bundles: async () => {
      const response = await ctx.remote.pluginManager.listBundles();
      return response.ok ? response.value : [];
    },
    subscribeBundles: (listener) => ctx.remote.$on("plugin-manager/changed", listener),
    entryFor,
    locale: NS,
    release: (ns) => {
      const entry = entries.get(ns);
      entries.delete(ns);
      entry?.controller.dispose();
    },
  });

  ctx.effect(() => {
    const offDescribe = ctx.configForms.describe().subscribe(() => {
      void registration.sync();
    });
    // 候选键变了（业务取到清单后才注册、或主动 refresh）：让已经建好的行重投影一次。
    const offHints = hints.subscribe(() => {
      for (const entry of entries.values()) entry.controller.refresh();
    });
    void registration.sync();
    return () => {
      offDescribe();
      offHints();
      registration.dispose();
      for (const [ns, entry] of entries) {
        entries.delete(ns);
        entry.controller.dispose();
      }
    };
  }, "ui-schema-form: row registrations");
}

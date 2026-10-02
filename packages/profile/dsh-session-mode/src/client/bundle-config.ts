// bundle 配置页的数据面：把 `session-mode` 行的 volatile schema 折成"默认模式 + 一串模式卡片"。
//
// 草稿、整段校验与保存都归通用 schema 表单的控制器（`SchemaFormController`）：本文件只声明页面摆哪些字段、把控制器
// 读数折成卡片视图、把页面动作收成一份注入面。字段路径就是真实路径（`modes.<模式 id>.<字段…>`），所以增删模式走
// 字典的 `addKey` / `removeKey`，模式里的每个字段走 `setText` / `set` / `clear`。
//
// 注册进 `plugins.bundle.config` 的 key 是 **bundle 包名**（页面按它取注册项），表单读写的却是 `session-mode` 行的
// 命名空间：bundle 装的就是这一行，两个面说的是同一份配置。

import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { createSnapshotStore, type SnapshotStore } from "@deepseek-ai/dsh-client-store";
import {
  failureOf,
  projectRoot,
  SchemaFormController,
  type SchemaFormState,
  type SelectOption,
  type SettingsFormShell,
  type ValidationFailure,
} from "@morlay/dsh-client-ui-primitives/client";
import type { BundleLocaleKey } from "./bundle-locales.ts";

// `session-mode` 行的 settings 命名空间：行 id。
export const SESSION_MODE_NS = "session-mode";

// 本页注册进 `plugins.bundle.config` 的 key：装这一行的 bundle 的包名。
export const BUNDLE_CONFIG_KEY = "@morlay/session-mode-profile";

// 不提供删除的模式：`noop` 是"什么都不加"的那一档，删掉它就没有与上游一致的对照面了。
export const PROTECTED_MODE_IDS: readonly string[] = ["noop"];

// 模式的角色取值：与 schema 的 `roleSchema`（`main` / `subagent` 两个字面量的集合）同源，改 schema 要一起改。
const ROLE_VALUES: readonly string[] = ["main", "subagent"];

// 字段的控件形状：文本 / 多行文本 / 选择器（有候选）/ 标签列表 / 开关 / 三态 / 角色。
type Control = "text" | "multiline" | "choice" | "tags" | "switch" | "tri" | "roles";

// 卡片里的分组（页面按它分段，顺序即数组顺序）。
export type GroupKey = "identity" | "persona" | "tools" | "rules" | "injections" | "model";

export const GROUPS: readonly { key: GroupKey; labelKey: BundleLocaleKey }[] = [
  { key: "identity", labelKey: "group.identity" },
  { key: "persona", labelKey: "group.persona" },
  { key: "tools", labelKey: "group.tools" },
  { key: "rules", labelKey: "group.rules" },
  { key: "injections", labelKey: "group.injections" },
  { key: "model", labelKey: "group.model" },
];

// 模式定义里的一个字段（路径相对模式定义，不含 `modes.<id>` 前缀）。
interface FieldSpec {
  readonly path: readonly string[];
  readonly control: Control;
  readonly labelKey: BundleLocaleKey;
  readonly hintKey: BundleLocaleKey;
  readonly group: GroupKey;
}

// 页面摆出来的字段与顺序。缺值的可选字段照常出现（控件显示"没写"，用户一填即是写）。
const MODE_FIELDS: readonly FieldSpec[] = [
  {
    path: ["name"],
    control: "text",
    labelKey: "field.name",
    hintKey: "hint.name",
    group: "identity",
  },
  {
    path: ["description"],
    control: "text",
    labelKey: "field.description",
    hintKey: "hint.description",
    group: "identity",
  },
  {
    path: ["role"],
    control: "roles",
    labelKey: "field.role",
    hintKey: "hint.role",
    group: "identity",
  },
  {
    path: ["presetsOnly"],
    control: "tags",
    labelKey: "field.presetsOnly",
    hintKey: "hint.presetsOnly",
    group: "identity",
  },
  {
    path: ["persona", "prefix"],
    control: "multiline",
    labelKey: "field.prefix",
    hintKey: "hint.prefix",
    group: "persona",
  },
  {
    path: ["persona", "suffix"],
    control: "multiline",
    labelKey: "field.suffix",
    hintKey: "hint.suffix",
    group: "persona",
  },
  {
    path: ["allowTools"],
    control: "tags",
    labelKey: "field.allowTools",
    hintKey: "hint.allowTools",
    group: "tools",
  },
  {
    path: ["denyTools"],
    control: "tags",
    labelKey: "field.denyTools",
    hintKey: "hint.denyTools",
    group: "tools",
  },
  {
    path: ["allowSkills"],
    control: "tags",
    labelKey: "field.allowSkills",
    hintKey: "hint.allowSkills",
    group: "tools",
  },
  {
    path: ["denySkills"],
    control: "tags",
    labelKey: "field.denySkills",
    hintKey: "hint.denySkills",
    group: "tools",
  },
  {
    path: ["allowPolicies"],
    control: "tags",
    labelKey: "field.allowPolicies",
    hintKey: "hint.allowPolicies",
    group: "rules",
  },
  {
    path: ["denyPolicies"],
    control: "tags",
    labelKey: "field.denyPolicies",
    hintKey: "hint.denyPolicies",
    group: "rules",
  },
  {
    path: ["instructions"],
    control: "switch",
    labelKey: "field.instructions",
    hintKey: "hint.instructions",
    group: "injections",
  },
  {
    path: ["skills"],
    control: "tri",
    labelKey: "field.skills",
    hintKey: "hint.skills",
    group: "injections",
  },
  {
    path: ["runtimeContext"],
    control: "switch",
    labelKey: "field.runtimeContext",
    hintKey: "hint.runtimeContext",
    group: "injections",
  },
  {
    path: ["defaultModel", "provider"],
    control: "choice",
    labelKey: "field.provider",
    hintKey: "hint.provider",
    group: "model",
  },
  {
    path: ["defaultModel", "model"],
    control: "choice",
    labelKey: "field.model",
    hintKey: "hint.model",
    group: "model",
  },
  {
    path: ["defaultModel", "reasoningEffort"],
    control: "text",
    labelKey: "field.reasoningEffort",
    hintKey: "hint.reasoningEffort",
    group: "model",
  },
];

// 控制器读数里一个字段的状态（`SchemaFormState.fields` 的值）。
type FieldRead = NonNullable<ReturnType<SchemaFormState["fields"]["get"]>>;

// 页面用的字典（键集合在 `bundle-locales.ts`）。
export type BundleTranslate = (key: BundleLocaleKey, args?: Record<string, unknown>) => string;

// 一个字段的显示状态：值（草稿优先）、是否还没写、是否覆盖了组成层。
export interface BundleFieldView {
  readonly key: string;
  readonly path: readonly string[];
  readonly control: Control;
  readonly label: string;
  // 字段下面那句说明（"这一项到底管什么"）。
  readonly hint: string;
  // 文本类控件的显示文本（草稿优先）。
  readonly text: string;
  // 开关 / 三态 / 角色 / 标签列表的当前值。
  readonly value: unknown;
  // 字段当前有没有值（"没写"的可选字段照常出现在页面上）。
  readonly present: boolean;
  readonly overridden: boolean;
  readonly options: readonly SelectOption[];
  readonly invalid: string | undefined;
}

// 一个模式的卡片。
export interface BundleModeView {
  readonly id: string;
  readonly title: string;
  readonly role: readonly string[];
  readonly summary: string;
  readonly deletable: boolean;
  // 这个模式里有还没保存的编辑。
  readonly staged: boolean;
  readonly groups: readonly {
    readonly key: GroupKey;
    readonly label: string;
    readonly fields: readonly BundleFieldView[];
  }[];
}

// 页面读这一行配置的阶段：
// - `loading`：设置面还没送到（还没读到这一行的命名空间）；
// - `missing`：设置面送到了，但没有 `session-mode` 这个命名空间（行没装或被禁用）；
// - `unreadable`：命名空间在，schema 却读不出来（rehydrate / 字段树失败）——这是配置面自己的问题，不是行没跑；
// - `ready`：可编辑。
export type BundleConfigReadiness = "loading" | "missing" | "unreadable" | "ready";

// 异常态的诊断读数：设置面现在有哪些命名空间，这一行的 schema 卡在哪，以及控制器那一侧的读数。
export interface BundleConfigDiagnosis {
  readonly namespaces: readonly string[];
  readonly problem: string;
  // 控制器当前投影的摘要 + 现建一个探针控制器的结果：用来区分"实例没跟上"与"这条路径本身失败"。
  readonly controller: string;
}

// 页面的完整读数。
export interface BundleConfigView extends SettingsFormShell {
  // 行的 schema 可渲染（否则页面只说明这一行没在跑）。
  readonly configured: boolean;
  readonly readiness: BundleConfigReadiness;
  readonly defaultMode: {
    readonly value: string;
    readonly options: readonly SelectOption[];
    readonly invalid: string | undefined;
  };
  readonly modes: readonly BundleModeView[];
  // 整段校验挡下的消息。
  readonly violation: string | undefined;
}

// 页面动作与读数（作为槽位注册项的 inject 面到达组件）。
export interface BundleConfigActions {
  set: (path: readonly string[], value: unknown) => void;
  // 上报一段文本：空文本＝恢复默认，其余按字面量暂存。
  editText: (path: readonly string[], text: string) => void;
  clear: (path: readonly string[]) => void;
  appendItem: (path: readonly string[]) => void;
  removeItem: (path: readonly string[], index: number) => void;
  addMode: (id: string) => void;
  removeMode: (id: string) => void;
  save: () => void;
  discard: () => void;
}

// 完整注入面：动作 + 读数（读数由框架绑成 `useBundleConfig`）。
export interface BundleConfigFace extends BundleConfigActions {
  readonly hooks: {
    readonly bundleConfig: SnapshotStore<SchemaFormState>;
    // 这一行命名空间的送达状态（`loading` / `ready` / `unavailable`）：页面据此区分"还在读"与"这一行没在跑"。
    readonly bundleStatus: SnapshotStore<ConfigStatus>;
  };
  // 异常态的诊断读数（页面只在读不出来时调用一次）。
  diagnose: () => BundleConfigDiagnosis;
  // 强制重读一次 describe 并重建投影（页面挂载时调用一次）：视图晚到、通知没落上时，这一步把它拉平。
  // 只在没有草稿时有效——重建出来的投影不带草稿，有草稿时直接跳过。
  resync: () => void;
}

// `ctx.configForms` 一个命名空间的送达状态（与 `ConfigFormSnapshot.status` 同源）。
export type ConfigStatus = "loading" | "ready" | "unavailable";

// cordis 会把服务值包成追踪代理（`Symbol.for("cordis.original")` 指回原始实例）。代理上的方法调用以代理为
// `this`，而服务实现用的是 JS 私有字段（`#texts` …）——私有字段只认声明它的那个实例，于是
// `Cannot read private member #texts from an object whose class did not declare it`。
// 读候选前先把服务解包成原始实例：这是跨副本共享的唯一入口，解包之后方法里的 `this` 才是原实例。
export function unwrapService<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  const original = (value as { [key: symbol]: unknown })[Symbol.for("cordis.original")];
  return (original ?? value) as T;
}

// 提示面（`schemaFormHints`）在本文件用到的读侧（订阅只在这里用：候选晚到时让页面重投影）。
export interface HintsLike {
  textFor(ns: string, path: readonly string[]): { label?: string; hint?: string };
  selectFor(ns: string, path: readonly string[]): SelectRead | undefined;
  sourceFor(name: string): SelectRead | undefined;
  subscribe(listener: () => void): () => void;
}

// 提示面的注册侧（业务行用它登记字段文案、候选键与候选值）。
export interface HintsService extends HintsLike {
  describe(
    ns: string,
    path: readonly string[],
    read: () => { label?: string; hint?: string },
  ): () => void;
  select(ns: string, path: readonly string[], spec: SelectRead): () => void;
  source(name: string, spec: SelectRead): () => void;
  refresh(): void;
}

// 候选源：依赖字段变化时按读数重算候选（`dependsOn` 只声明"何时重算"，值由 options 自己读）。
interface SelectRead {
  dependsOn?: readonly (readonly string[])[] | undefined;
  options: (read: (path: readonly string[]) => unknown) => readonly SelectOption[];
}

// 字段在状态表里的键（与渲染层的约定一致：具体路径的 JSON）。
export function fieldKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

// 组装这一页：控制器（草稿 + 校验 + 保存）与注入面（连同它的释放）。
//
// 整段校验 = schema 自己的校验，加上页面能立刻说的跨字段规则（默认模式必须在清单里、默认模型要成对）。
export function createBundleConfigFace(
  ctx: ClientContext,
  t: BundleTranslate,
  // 提示面（候选值：服务商、模型、policy 名单）：由调用方以**属性访问**取到再传进来——`ctx.get(name)` 给的是
  // cordis 的追踪代理，调它上面带 JS 私有字段的方法会抛
  // `Cannot read private member #x from an object whose class did not declare it`。
  hintsOf: () => HintsLike | undefined = () => undefined,
): { face: BundleConfigFace; refresh: () => void; dispose: () => void } {
  const forms = ctx.configForms;
  const hints = (): HintsLike | undefined => unwrapService(hintsOf());
  const deps = (): ConstructorParameters<typeof SchemaFormController>[1] => ({
    form: forms.get(SESSION_MODE_NS),
    describe: forms.describe(),
    rehydrate: (serialized: unknown) => ctx.settingsSchema.rehydrate(serialized),
    validate: (schema: unknown, value: unknown) => validateSection(schema, value, t),
    t: ctx.locale.bind("settings.schema-form"),
    hints: {
      keysFor: () => [],
      textFor: (path: readonly string[]) => hints()?.textFor(SESSION_MODE_NS, path) ?? {},
      selectFor: (path: readonly string[]) => hints()?.selectFor(SESSION_MODE_NS, path),
      sourceFor: (name: string) => hints()?.sourceFor(name),
    },
  });
  const controller = new SchemaFormController(SESSION_MODE_NS, deps());
  const face = controller.face();
  const form = forms.get(SESSION_MODE_NS);
  const statusStore = createSnapshotStore<ConfigStatus>(form.getSnapshot().status);
  const unsubscribeStatus = form.subscribe(() => {
    statusStore.set(form.getSnapshot().status);
  });
  // 诊断：只在页面读不出来时被调用——把"设置面有哪些命名空间"和"这一行为什么渲染不出来"说清。
  const diagnose = (): BundleConfigDiagnosis => {
    const view = forms.describe().getSnapshot().view;
    const namespaces = view?.namespaces.map((row) => row.ns) ?? [];
    const live = controller.face().hooks.schemaForm.getSnapshot();
    const controllerSummary = `store configured=${String(live.configured)} walked=${String(live.walked.length)}`;
    const own = view?.namespaces.find((row) => row.ns === SESSION_MODE_NS);
    if (own === undefined) {
      return {
        namespaces,
        controller: controllerSummary,
        problem: `describe has no namespace "${SESSION_MODE_NS}"`,
      };
    }
    try {
      const schema = ctx.settingsSchema.rehydrate(own.schema) as unknown as { type?: unknown };
      const renderable =
        projectRoot(own.schema, (serialized: unknown) =>
          ctx.settingsSchema.rehydrate(serialized),
        ) !== undefined;
      // 探针：用同一份依赖现建一个控制器，看控制器的构造路径本身会不会失败。
      let probe: string;
      try {
        const rebuilt = new SchemaFormController(SESSION_MODE_NS, deps());
        probe = `probe configured=${String(rebuilt.face().hooks.schemaForm.getSnapshot().configured)}`;
        rebuilt.dispose();
      } catch (error: unknown) {
        probe = `probe threw: ${error instanceof Error ? error.message : String(error)}`;
      }
      return {
        namespaces,
        controller: `${controllerSummary}; ${probe}`,
        problem: renderable ? "renderable" : `schema root is "${String(schema.type)}"`,
      };
    } catch (error: unknown) {
      return {
        namespaces,
        controller: controllerSummary,
        problem: `schema rehydrate failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
  // 重建一次并把投影写回**现有的** store：组件的 hook 绑的就是这个 store，所以只换读数、不换引用。
  // 重读一次 describe 与候选（`SchemaFormController.refresh` 现在就是重读，草稿不动）。
  const resync = (): void => {
    statusStore.set(form.getSnapshot().status);
    controller.refresh();
  };
  return {
    face: {
      hooks: { bundleConfig: face.hooks.schemaForm, bundleStatus: statusStore },
      diagnose,
      resync,
      set: (path, value) => {
        face.set(path, value);
      },
      editText: (path, text) => {
        // 空文本＝这一项恢复默认（清掉用户层）；非空按字面量暂存，保存那一刻再解析。
        if (text === "") face.clear(path);
        else face.setText(path, text, (raw) => ({ kind: "value", value: raw }));
      },
      clear: (path) => {
        face.clear(path);
      },
      appendItem: (path) => {
        face.appendItem(path);
      },
      removeItem: (path, index) => {
        face.removeItem(path, index);
      },
      addMode: (id) => {
        const trimmed = id.trim();
        if (trimmed === "") return;
        face.addKey(["modes"], trimmed);
        // 新模式的名称默认给 id：`name` 在 schema 上必填且没有默认值，留空会被校验挡下。
        face.setText(["modes", trimmed, "name"], trimmed, (raw) => ({ kind: "value", value: raw }));
      },
      removeMode: (id) => {
        if (PROTECTED_MODE_IDS.includes(id)) return;
        face.removeKey(["modes"], id);
      },
      save: () => {
        face.save();
      },
      discard: () => {
        face.discard();
      },
    },
    refresh: resync,
    dispose: () => {
      unsubscribeStatus();
      controller.dispose();
    },
  };
}

// 整段校验：schema 先说话（消息带路径），再看跨字段的那几条。
function validateSection(
  schema: unknown,
  value: unknown,
  t: BundleTranslate,
): ValidationFailure | undefined {
  try {
    (schema as (input: unknown) => unknown)(value);
  } catch (error: unknown) {
    return failureOf(error);
  }
  return rosterProblem(value, t);
}

// 跨字段规则：至少一个模式、默认模式在清单里、默认模型要成对（与 host 装配期那份判据同向）。
function rosterProblem(value: unknown, t: BundleTranslate): ValidationFailure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const modes: unknown = Reflect.get(value, "modes");
  if (typeof modes !== "object" || modes === null || Array.isArray(modes)) {
    return { message: t("violation.modesEmpty"), path: ["modes"] };
  }
  const ids = Object.keys(modes);
  if (ids.length === 0) return { message: t("violation.modesEmpty"), path: ["modes"] };
  const selected: unknown = Reflect.get(value, "default");
  if (typeof selected === "string" && selected !== "" && !ids.includes(selected)) {
    return { message: t("violation.defaultMissing"), path: ["default"] };
  }
  for (const id of ids) {
    const mode: unknown = Reflect.get(modes, id);
    const model: unknown =
      typeof mode === "object" && mode !== null ? Reflect.get(mode, "defaultModel") : undefined;
    if (typeof model !== "object" || model === null) continue;
    const provider: unknown = Reflect.get(model, "provider");
    const name: unknown = Reflect.get(model, "model");
    if (provider === undefined && name === undefined) continue;
    if (
      typeof provider === "string" &&
      provider !== "" &&
      typeof name === "string" &&
      name !== ""
    ) {
      continue;
    }
    return { message: t("violation.modelPair"), path: ["modes", id, "defaultModel"] };
  }
  return undefined;
}

// 把控制器读数折成页面视图。
export function projectBundleConfig(
  state: SchemaFormState,
  t: BundleTranslate,
  status: ConfigStatus = "ready",
): BundleConfigView {
  const read = (path: readonly string[]): FieldRead | undefined => state.fields.get(fieldKey(path));
  const optionsAt = (path: readonly string[]): readonly SelectOption[] =>
    state.options.get(fieldKey(path)) ?? [];
  const invalidAt = (path: readonly string[]): string | undefined =>
    state.invalidAt.get(fieldKey(path)) ?? read(path)?.invalid;

  const modes = collectModeIds(state);
  const selected = textOf(read(["default"]));
  return {
    available: state.available,
    writable: state.writable,
    dirty: state.dirty,
    invalid: state.invalid,
    saving: state.saving,
    failed: state.failed,
    configured: state.configured,
    readiness: state.configured
      ? "ready"
      : status === "loading"
        ? "loading"
        : status === "ready"
          ? "unreadable"
          : "missing",
    defaultMode: {
      value: selected,
      options: modes.map((id) => ({ value: id, label: labelOf(id, read) })),
      invalid:
        invalidAt(["default"]) ??
        (selected === "" || modes.includes(selected) ? undefined : t("violation.defaultMissing")),
    },
    modes: modes.map((id) => ({
      id,
      title: labelOf(id, read),
      role: arrayOf(read(["modes", id, "role"])),
      summary: summaryOf(id, read, t),
      deletable: !PROTECTED_MODE_IDS.includes(id),
      staged: MODE_FIELDS.some((spec) => read(["modes", id, ...spec.path])?.staged === true),
      groups: GROUPS.map((group) => ({
        key: group.key,
        label: t(group.labelKey),
        fields: MODE_FIELDS.filter((spec) => spec.group === group.key).map((spec) =>
          fieldView(id, spec, read, optionsAt, invalidAt, t),
        ),
      })),
    })),
    violation: state.violation?.message,
  };
}

// 模式在页面上的标题：名称（没写名称就用 id）。
function labelOf(id: string, read: (path: readonly string[]) => FieldRead | undefined): string {
  const name = textOf(read(["modes", id, "name"]));
  return name === "" ? id : name;
}

// 模式清单：从展开后的字段路径里收集 `modes.<id>` 的第二个段（顺序即配置顺序）。
function collectModeIds(state: SchemaFormState): string[] {
  const ids: string[] = [];
  for (const item of state.walked) {
    if (item.path.length < 2 || item.path[0] !== "modes") continue;
    const id = item.path[1];
    if (id === undefined || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

// 一个字段的视图。
function fieldView(
  id: string,
  spec: FieldSpec,
  read: (path: readonly string[]) => FieldRead | undefined,
  optionsAt: (path: readonly string[]) => readonly SelectOption[],
  invalidAt: (path: readonly string[]) => string | undefined,
  t: BundleTranslate,
): BundleFieldView {
  const path = ["modes", id, ...spec.path];
  const field = read(path);
  const common = {
    key: fieldKey(path),
    path,
    control: spec.control,
    label: t(spec.labelKey),
    hint: t(spec.hintKey),
    present: field !== undefined,
    overridden: field?.overridden === true,
    options: optionsAt(path),
    invalid: invalidAt(path),
  };
  if (spec.control === "tags" || spec.control === "roles") {
    return { ...common, text: "", value: arrayOf(field) };
  }
  if (spec.control === "switch") {
    return { ...common, text: "", value: field?.value === true };
  }
  if (spec.control === "tri") {
    return { ...common, text: "", value: triOf(field) };
  }
  return { ...common, text: textOf(field), value: field?.value };
}

// 三态字段（`skills`）：`unset` 表示配置里没写这个键（按工具名单推导），另两档是显式的开关值。
function triOf(field: FieldRead | undefined): "unset" | "on" | "off" {
  if (field === undefined || field.value === undefined) return "unset";
  return field.value === true ? "on" : "off";
}

// 一个模式的摘要行：工具面与模型面（页面上"一眼看出这个模式收窄了什么"）。
function summaryOf(
  id: string,
  read: (path: readonly string[]) => FieldRead | undefined,
  t: BundleTranslate,
): string {
  const allowed = arrayOf(read(["modes", id, "allowTools"]));
  const denied = arrayOf(read(["modes", id, "denyTools"]));
  const provider = read(["modes", id, "defaultModel", "provider"])?.value;
  const model = read(["modes", id, "defaultModel", "model"])?.value;
  const tools =
    allowed.length > 0
      ? t("summary.tools", { n: String(allowed.length) })
      : denied.length > 0
        ? t("summary.denyTools", { n: String(denied.length) })
        : t("summary.allTools");
  const picked =
    typeof model === "string" && model !== ""
      ? `${typeof provider === "string" && provider !== "" ? `${provider} / ` : ""}${model}`
      : t("summary.globalModel");
  return `${tools} · ${picked}`;
}

// 字段的显示文本：草稿优先，否则格式化生效值。
function textOf(field: FieldRead | undefined): string {
  if (field === undefined) return "";
  if (typeof field.text === "string") return field.text;
  return typeof field.value === "string" ? field.value : "";
}

// 数组值：非数组（含缺省）当空数组。
function arrayOf(field: FieldRead | undefined): string[] {
  const value = field?.value;
  return Array.isArray(value) ? value.map((item) => String(item)) : ([] as string[]);
}

// 角色取值（页面用它画两个复选框）。
export const ROLES: readonly string[] = ROLE_VALUES;

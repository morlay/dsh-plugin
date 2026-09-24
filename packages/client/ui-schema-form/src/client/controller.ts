/**
 * 一行的配置页控制器：把 describe 里的 volatile schema 投影成字段树，绑上该命名空间的共享配置表单与草稿模型。
 *
 * 一个命名空间一个实例（行 id 就是 settings 命名空间）。行被 describe 出来之后 `configured` 才是 true：
 * schema 变了就重新投影字段树（模型不重建，草稿仍在），行消失时页面只显示一行说明。
 */

import type { SettingsNamespaceView } from "@deepseek-ai/dsh-api-remotes/client";
import { createSnapshotStore, type SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { SettingsFormShell } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SchemaNode, SettingsDescribeFace } from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  SchemaDraftModel,
  type DraftFieldState,
  type DraftScope,
  type Section,
  type TextParse,
  type ValidationFailure,
} from "./draft.ts";
import {
  emptyMeta,
  fieldsOf,
  mergeKeyConflict,
  projectNode,
  readPath,
  unwrapLazy,
  variantOf,
  walkFields,
  type FieldNode,
  type SuggestedKeys,
  type WalkedField,
} from "./schema-node.ts";
import type { FieldText, SelectOption, SelectSpec } from "./hints.ts";
import type { SchemaFormTranslate } from "./slot-contract.ts";

/** 字段在状态表里的键（具体路径的 JSON）。 */
export function fieldKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

/**
 * rehydrate 一段配置 schema，并判它能不能当页面的根。
 *
 * 能当根的形状有三种：对象段、**相交段**（共享判别字段 + 各分支的 `const` 标记，段值仍是对象）、以及带判别
 * 标签的 `union`（成员都是对象）。字面量 `union`（整段就是一个标量）不行：那一行的写盘会变成整段替换。
 * @param serialized - host 发来的 `schema.toJSON()`。
 * @param rehydrate - host schema 的 rehydrate。
 * @returns schema 与它的字段树，或 `undefined`（不能当页面根）。
 */
export function projectRoot(
  serialized: unknown,
  rehydrate: (serialized: unknown) => SchemaNode,
): { schema: SchemaNode; root: FieldNode } | undefined {
  try {
    const schema = rehydrate(serialized);
    const root = projectNode(schema);
    if (root.type === "object" || root.type === "intersect") return { schema, root };
    if (root.type === "union" && root.tagKey !== undefined && root.choices === undefined) {
      return { schema, root };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 一行能否自动生成配置页：它的 schema 能 rehydrate 且根是 {@link projectRoot} 认的形状。
 * @param view - host 发来的命名空间视图。
 * @param rehydrate - host schema 的 rehydrate。
 * @returns 是否可以渲染。
 */
export function canRender(
  view: SettingsNamespaceView | undefined,
  rehydrate: (serialized: unknown) => SchemaNode,
): boolean {
  return view !== undefined && projectRoot(view.schema, rehydrate) !== undefined;
}

/** 段根不是可渲染对象时的空字段树。 */
const NO_FIELDS: FieldNode = {
  key: "",
  path: [],
  label: undefined,
  meta: emptyMeta(),
  readOnly: null,
  type: "object",
  fields: [],
};

/** 提示面在控制器里的读法：候选键 + 字段文案 + 候选值。 */
export interface HintSources extends SuggestedKeys {
  /**
   * 读某个字段的文案。
   * @param path - 该字段的具体路径。
   * @returns 业务注册的文案；没有就是空对象。
   */
  textFor: (path: readonly string[]) => FieldText;
  /**
   * 读某个字段的候选值读数；不接提示面的装配可以不给（字段就还是文本编辑）。
   * @param path - 该字段的具体路径。
   * @returns 业务注册的候选读数；没有就是 `undefined`。
   */
  selectFor?: ((path: readonly string[]) => SelectSpec | undefined) | undefined;
}

/** 控制器要的外部面（`apply` 里从 cordis ctx 组装；测试直接给替身）。 */
export interface SchemaFormDeps {
  /** 本命名空间的共享配置表单（读 + 带栅栏的写）。 */
  form: DraftScope;
  /** describe mirror 的读面：本行的 schema、autoGenerate 与 secret 槽。 */
  describe: SettingsDescribeFace;
  /** rehydrate host 发来的 `schema.toJSON()`。 */
  rehydrate: (serialized: unknown) => SchemaNode;
  /** 整段校验；失败时连路径一起给（页面把消息画在那一行）。 */
  validate: (schema: SchemaNode, value: unknown) => ValidationFailure | undefined;
  /** 本包字典（项身份冲突这类本地校验的消息）。 */
  t: SchemaFormTranslate;
  /**
   * dict 字段的候选键（业务注册，见 `hints.ts`）：候选里有、值里没有的键会补成一行「未配置」，
   * 用户填了才算写。
   */
  hints?: HintSources | undefined;
}

/**
 * 这一层「能加进来」的一项：schema 里声明、值里还没有的字段，或业务注册的候选键。
 *
 * 页面上不占行——它们出现在容器的闭合行那个「添加属性 / 添加键」输入框的候选里，选中才加。
 */
export interface AddableProperty {
  /** 加进来的键名。 */
  key: string;
  /** 说明（schema 的 `description` / `comment`，可能是本地化字典）：渲染层解析后当候选的副标题。 */
  description: string | Readonly<Record<string, string>> | undefined;
}

/** 值里已有的键（数组给索引）。 */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((_item, index) => String(index));
  if (typeof value === "object" && value !== null) return Object.keys(value);
  return [];
}

/**
 * 一个容器当前能加什么。
 *
 * 对象层（含相交与 union 的选中变体）是**非必填**、值里又没有的字段——必填的已经占着行了；字典层是业务注册的
 * 候选键（模式清单这类运行期数据）。数组层不在这里：它的「添加一项」是追加一个空项，没有键名可选。
 * @param node - 容器节点。
 * @param path - 该容器的具体路径。
 * @param value - 该容器自己的值（草稿后的）。
 * @param hints - 提示面（只用到候选键）。
 * @returns 可添加项，顺序即 schema / 读数的顺序；列表为空时页面不给输入框。
 */
export function addableAt(
  node: FieldNode,
  path: readonly string[],
  value: unknown,
  hints: SuggestedKeys | undefined,
): readonly AddableProperty[] {
  const current = variantOf(node, value);
  if (current.type === "dict") {
    const present = new Set(keysOf(value));
    return (hints?.keysFor(path) ?? []).flatMap((key) =>
      present.has(key) ? [] : [{ key, description: undefined }],
    );
  }
  if (current.type !== "object" && current.type !== "intersect") return [];
  return fieldsOf(current).flatMap((field) =>
    field.meta.required !== true && readPath(value, [field.key]) === undefined
      ? [{ key: field.key, description: field.meta.description ?? field.meta.comment }]
      : [],
  );
}

/** 页面级状态：表单壳 + 字段树 + 每字段草稿状态。 */
export interface SchemaFormState extends SettingsFormShell {
  /** 这一行的 schema 是否可渲染（否则页面只显示一行说明）。 */
  configured: boolean;
  /** 字段树；未 configured 时是空对象树。 */
  root: FieldNode;
  /** 按草稿后的值展开的字段列表（渲染顺序）：追加的数组项与新增的字典键立刻出现。 */
  walked: readonly WalkedField[];
  /** 每个具体路径的草稿状态，键见 {@link fieldKey}。 */
  fields: ReadonlyMap<string, DraftFieldState>;
  /** secret 槽是否已配置，键见 {@link fieldKey}。 */
  secrets: ReadonlyMap<string, boolean>;
  /** 每个字段的文案（提示面注册的），键见 {@link fieldKey}；渲染层把它画成注释行。 */
  texts: ReadonlyMap<string, FieldText>;
  /**
   * 每个字段的可选项，键见 {@link fieldKey}：字面量集合的 union 自带候选，其余来自提示面。
   * 候选依赖的兄弟字段一改，这里就跟着变（投影时按草稿后的值求一次）。
   */
  options: ReadonlyMap<string, readonly SelectOption[]>;
  /**
   * 每个容器能加进来的项，键见 {@link fieldKey}（容器自己的路径）。没有条目就是加不了东西——对象层的输入框
   * 因此只在还有声明字段没配时出现。
   */
  addable: ReadonlyMap<string, readonly AddableProperty[]>;
  /** 保存被 schema 挡下时的消息与它的位置。 */
  violation: ValidationFailure | undefined;
  /** 每行的校验消息（键见 {@link fieldKey}）：行内报错，与底部的整段提示同源。 */
  invalidAt: ReadonlyMap<string, string>;
}

/** 控件的写动作：全部落在草稿上，`save` 是唯一的写盘点。 */
export interface SchemaFormActions {
  /** 暂存一个合法值。 */
  set: (path: readonly string[], value: unknown) => void;
  /** 暂存一段文本（保存时解析）。 */
  setText: (path: readonly string[], text: string, parse: TextParse) => void;
  /** 暂存「恢复默认」。 */
  clear: (path: readonly string[]) => void;
  /** 追加一个数组项。 */
  appendItem: (path: readonly string[]) => void;
  /** 移除一个数组项。 */
  removeItem: (path: readonly string[], index: number) => void;
  /** 加一个字典键。 */
  addKey: (path: readonly string[], key: string) => void;
  /** 删一个字典键。 */
  removeKey: (path: readonly string[], key: string) => void;
  /** 写盘。 */
  save: () => void;
  /** 撤销一个字段的草稿（行内编辑取消）。 */
  revert: (path: readonly string[]) => void;
  /** 丢弃草稿。 */
  discard: () => void;
}

/** 槽位渲染器绑定的动作与可观察状态。 */
export interface SchemaFormFace extends SchemaFormActions {
  hooks: {
    schemaForm: SnapshotStore<SchemaFormState>;
  };
}

/**
 * 一个字段的可选项。
 *
 * 字面量集合的 union（`z.union(["wal", "delete"])`）自己就带着候选；其余看提示面注册的读数——读的时候把依赖的
 * 兄弟字段值喂进去，所以「选完服务商才列它有哪些模型」是投影的一部分，不是额外的一次订阅。
 * @param node - 字段节点。
 * @param path - 该字段的具体路径。
 * @param value - 段值（草稿后的）。
 * @param hints - 提示面。
 * @returns 可选项；没有候选就是 `undefined`。
 */
export function optionsFor(
  node: FieldNode,
  path: readonly string[],
  value: unknown,
  hints: HintSources | undefined,
): readonly SelectOption[] | undefined {
  const current = unwrapLazy(node);
  if (current?.type === "union" && current.choices !== undefined) {
    return current.choices.map((choice) => ({ value: choice }));
  }
  const spec = hints?.selectFor?.(path);
  if (spec === undefined) return undefined;
  const parent = path.slice(0, -1);
  const options = spec.options((relative) => readPath(value, [...parent, ...relative]));
  return options.length === 0 ? undefined : options;
}

/**
 * 一行配置页的控制器。
 */
export class SchemaFormController {
  readonly #ns: string;
  readonly #deps: SchemaFormDeps;
  readonly #model: SchemaDraftModel;
  readonly #store: SnapshotStore<SchemaFormState>;
  readonly #disposers: (() => void)[] = [];
  #view: SettingsNamespaceView | undefined;
  #schema: SchemaNode | undefined;
  #root: FieldNode | undefined;

  /**
   * @param ns - settings 命名空间（行 id）。
   * @param deps - 该行的共享表单与 schema 面。
   */
  constructor(ns: string, deps: SchemaFormDeps) {
    this.#ns = ns;
    this.#deps = deps;
    this.#model = new SchemaDraftModel({
      scope: deps.form,
      root: NO_FIELDS,
      validate: (value) => this.#validate(deps, value),
    });
    this.#store = createSnapshotStore(this.#project());
    this.#disposers.push(
      this.#model.subscribe(() => {
        this.#store.set(this.#project());
      }),
    );
    this.#disposers.push(
      deps.describe.subscribe(() => {
        this.#sync();
      }),
    );
    void deps.describe.ensure();
    this.#sync();
  }

  /** 槽位渲染器要的动作与状态。 */
  face(): SchemaFormFace {
    return {
      hooks: { schemaForm: this.#store },
      set: (path, value) => {
        this.#model.set(path, value);
      },
      setText: (path, text, parse) => {
        this.#model.setText(path, text, parse);
      },
      clear: (path) => {
        this.#model.clear(path);
      },
      appendItem: (path) => {
        this.#model.appendItem(path);
      },
      removeItem: (path, index) => {
        this.#model.removeItem(path, index);
      },
      addKey: (path, key) => {
        this.#model.addKey(path, key);
      },
      removeKey: (path, key) => {
        this.#model.removeKey(path, key);
      },
      save: () => {
        void this.#model.save();
      },
      revert: (path) => {
        this.#model.revert(path);
      },
      discard: () => {
        this.#model.discard();
      },
    };
  }

  /** 本行的 settings 命名空间。 */
  namespace(): string {
    return this.#ns;
  }

  /** 外部提示（候选键这类）变了：重新投影一次，字段树与草稿都不动。 */
  refresh(): void {
    this.#store.set(this.#project());
  }

  /** 释放订阅。 */
  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) dispose();
    this.#model.dispose();
  }

  /** 重新读 schema（describe 变了）：只换字段树，草稿与 store 不动。 */
  #sync(): void {
    const view = this.#deps.describe
      .getSnapshot()
      .view?.namespaces.find((row) => row.ns === this.#ns);
    this.#view = view;
    const projected =
      view === undefined ? undefined : projectRoot(view.schema, this.#deps.rehydrate);
    this.#schema = projected?.schema;
    this.#root = projected?.root;
    // 增删项要按新的字段树取默认值（行的 Config 可能刚改过）。
    this.#model.setRoot(projected?.root ?? NO_FIELDS);
    this.#store.set(this.#project());
  }

  /** 整段校验：schema 先说话，再看数组的项身份有没有冲突。 */
  #validate(deps: SchemaFormDeps, value: Section): ValidationFailure | undefined {
    if (this.#schema !== undefined) {
      const failure = deps.validate(this.#schema, value);
      if (failure !== undefined) return failure;
    }
    if (this.#root === undefined) return undefined;
    const conflict = mergeKeyConflict(this.#root, value);
    if (conflict === undefined) return undefined;
    return {
      message:
        conflict.kind === "duplicate"
          ? deps.t("duplicateItem", { key: conflict.mergeKey, value: conflict.value })
          : deps.t("missingItem", { key: conflict.mergeKey }),
      path: conflict.path,
    };
  }

  /** 渲染层读的一份完整投影。 */
  #project(): SchemaFormState {
    const fields = new Map<string, DraftFieldState>();
    const root = this.#root;
    // 一次投影只算一份读数：字段树与每一行的值都从它来——容器的值因此也含别处的草稿（判别式 union 的选支就是它）。
    const preview = this.#model.preview();
    const walked = root === undefined ? [] : walkFields(root, preview);
    for (const item of walked) {
      fields.set(fieldKey(item.path), this.#model.field(item.path, preview));
    }
    const secrets = new Map<string, boolean>();
    for (const secret of this.#view?.secrets ?? []) secrets.set(fieldKey(secret.path), secret.set);
    const texts = new Map<string, FieldText>();
    const options = new Map<string, readonly SelectOption[]>();
    const addable = new Map<string, readonly AddableProperty[]>();
    for (const item of walked) {
      const text = this.#deps.hints?.textFor(item.path);
      if (text !== undefined) texts.set(fieldKey(item.path), text);
      const candidates = optionsFor(item.node, item.path, preview, this.#deps.hints);
      if (candidates !== undefined) options.set(fieldKey(item.path), candidates);
      const addableHere = addableAt(
        item.node,
        item.path,
        readPath(preview, item.path),
        this.#deps.hints,
      );
      if (addableHere.length > 0) addable.set(fieldKey(item.path), addableHere);
    }
    // 整段校验失败落在哪一行，就在哪一行说（底部只留整段级的那份）。
    const violation = this.#model.violation();
    const invalidAt = new Map<string, string>();
    if (violation !== undefined && violation.path.length > 0) {
      invalidAt.set(fieldKey(violation.path), violation.message);
    }
    return {
      ...this.#model.shell(),
      configured: root !== undefined,
      root: root ?? NO_FIELDS,
      walked,
      fields,
      secrets,
      texts,
      options,
      addable,
      violation,
      invalidAt,
    };
  }
}

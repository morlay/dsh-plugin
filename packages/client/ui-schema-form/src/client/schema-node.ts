/**
 * schema 投影：把 host 发来的 volatile 表单 schema 变成渲染层要的字段树。
 *
 * 投影只描述**结构**（字段、路径、meta、只读原因），不读值、不做本地化、不碰 React：值在 `draft.ts`，
 * 文案在 `labels.ts`，控件在 `fields/`。动态子节点（dict 的键与值、array 的项）的路径段用
 * {@link DYNAMIC_SEGMENT} 占位，渲染层按真实键/索引替换后再交给字段槽。
 */

import type { SchemaNode } from "@deepseek-ai/dsh-client-ui-settings/client";

/** 动态子节点的路径占位段（dict 的键与值、array 的项）：渲染层按真实键或索引替换。 */
export const DYNAMIC_SEGMENT = "*";

/** 节点不可编辑的原因；`null` 表示可编辑。 */
export type ReadOnlyReason = "transform" | "function" | "constructor";

/** 归一化后的字段元数据（schemastery `meta` 的可用子集）。 */
export interface FieldMeta {
  /** `description`（可能是本地化字典）：渲染时经 locale 解析。 */
  description: string | Readonly<Record<string, string>> | undefined;
  /** `comment`：纯文本补充说明。 */
  comment: string | undefined;
  /** `link`：外部文档。 */
  link: string | undefined;
  /** `role`：控件提示（`secret` / `slider` / `datetime` …）。 */
  role: string | undefined;
  /** `role === 'secret'`：值不回传，只能写。 */
  secret: boolean;
  /** `required()`。 */
  required: boolean;
  /** `disabled()`：控件禁用。 */
  disabled: boolean;
  /** `collapse()`：嵌套分组默认折叠。 */
  collapse: boolean;
  /** `deprecated()` / `experimental()` 的徽标文本。 */
  badges: readonly string[];
  /** `pattern()` 的正则来源。 */
  pattern: string | undefined;
  /** `min()`。 */
  min: number | undefined;
  /** `max()`。 */
  max: number | undefined;
  /** `step()`：`1` 表示整数。 */
  step: number | undefined;
  /** 是否声明了默认值（与「默认值是 undefined」区分开）。 */
  hasDefault: boolean;
  /** 声明的默认值。 */
  defaultValue: unknown;
  /** `extra()`：角色附带的任意数据，字段槽的自定义控件可用。 */
  extra: unknown;
}

/** 每种节点共有的部分。 */
export interface FieldNodeBase {
  /** 这一层的名字：对象字段名、tuple 的索引、动态子节点的占位段。 */
  key: string;
  /** 从段根起的路径；动态段是 {@link DYNAMIC_SEGMENT}。 */
  path: readonly string[];
  /**
   * 按值展开时算好的显示名：数组成员的**项身份**（见 {@link FieldNodeBase} 所在的 array 节点）。
   * 投影时没有（`undefined`），渲染层用它优先于字段名。
   */
  label: string | undefined;
  /** 归一化后的元数据。 */
  meta: FieldMeta;
  /** 不可编辑的原因；`null` 表示可编辑。 */
  readOnly: ReadOnlyReason | null;
}

/** 位集的一位。 */
export interface BitsEntry {
  name: string;
  bit: number;
}

/** 渲染层要的一个字段节点。 */
export type FieldNode =
  | (FieldNodeBase & { type: "object"; fields: readonly FieldNode[] })
  | (FieldNodeBase & { type: "dict"; keyNode: FieldNode; valueNode: FieldNode })
  | (FieldNodeBase & {
      type: "array";
      item: FieldNode;
      /**
       * 项的**身份键**：这一项的「名字」取自它自己的哪个字段。显式声明优先
       * （`z.array(inner).role('items', { mergeKey: 'id' })`），否则 item 上有 `id` 字段就用 `id`。
       * 它只决定显示名与「同名即冲突」的判据——写盘仍按索引（host 的 path op 就是索引语义）。
       */
      mergeKey: string | undefined;
    })
  | (FieldNodeBase & { type: "tuple"; items: readonly FieldNode[] })
  | (FieldNodeBase & {
      type: "union";
      /** 成员全是字面量时的可选项；否则 `undefined`。 */
      choices: readonly unknown[] | undefined;
      variants: readonly FieldNode[];
      /**
       * 判别标签：按哪个字段的值挑变体。显式声明优先
       * （`z.union([...]).role('union', { tag: 'kind' })`），否则取所有对象成员共有的**唯一**常量字段。
       * schemastery 本身没有 tag 机制（union 按声明顺序逐个试），所以这只是渲染与校验的选支依据。
       */
      tagKey: string | undefined;
    })
  | (FieldNodeBase & { type: "intersect"; members: readonly FieldNode[] })
  | (FieldNodeBase & { type: "bitset"; bits: readonly BitsEntry[] })
  | (FieldNodeBase & { type: "const"; value: unknown })
  | (FieldNodeBase & { type: "lazy"; inner: FieldNode })
  | (FieldNodeBase & { type: "string" | "number" | "boolean" | "any" | "never" | "function" })
  /** 自引用 schema 回到祖先处：值这一层以下不再描述，由渲染层展开或只读呈现。 */
  | (FieldNodeBase & { type: "recursive"; origin: string });

/** 空的元数据：动态子节点（无声明 schema 的 dict 键）与空字段树用它。 */
export function emptyMeta(): FieldMeta {
  return {
    description: undefined,
    comment: undefined,
    link: undefined,
    role: undefined,
    secret: false,
    required: false,
    disabled: false,
    collapse: false,
    badges: [],
    pattern: undefined,
    min: undefined,
    max: undefined,
    step: undefined,
    hasDefault: false,
    defaultValue: undefined,
    extra: undefined,
  };
}

/** `badges` 只留文本：配色与文案由字典决定。 */
function badgesOf(meta: SchemaNode["meta"]): string[] {
  return (meta.badges ?? []).map((badge) => badge.text);
}

/** 归一化一个节点的 meta。 */
function metaOf(schema: SchemaNode): FieldMeta {
  const meta = schema.meta ?? {};
  return {
    description: meta.description,
    comment: meta.comment,
    link: meta.link,
    role: meta.role,
    secret: meta.role === "secret",
    required: meta.required === true,
    disabled: meta.disabled === true,
    collapse: meta.collapse === true,
    badges: badgesOf(meta),
    // `toJSON()` 之后 pattern 已经是字符串（source），只有直接传 schema 时才是 RegExp。
    pattern: typeof meta.pattern === "string" ? meta.pattern : (meta.pattern?.source ?? undefined),
    min: meta.min,
    max: meta.max,
    step: meta.step,
    hasDefault: meta.default !== undefined,
    defaultValue: meta.default,
    extra: meta.extra,
  };
}

/** 外层 meta 与内层 meta 合并：外层的 undefined 不覆盖内层（transform 的 inner 带着自己的角色）。 */
function mergeMeta(inner: FieldMeta, outer: FieldMeta): FieldMeta {
  const merged: Record<string, unknown> = { ...inner };
  for (const [key, value] of Object.entries(outer)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as FieldMeta;
}

/** 节点自己的路径末段：动态段保持占位，根节点为空串。 */
function keyOf(path: readonly string[]): string {
  return path[path.length - 1] ?? "";
}

/** 一个纯字符串叶子（dict 没有声明键 schema 时用它）。 */
function stringLeaf(path: readonly string[], meta: FieldMeta): FieldNode {
  return { key: keyOf(path), path, label: undefined, meta, readOnly: null, type: "string" };
}

/** 把 schema 的类型名收口成渲染层认识的那几种。 */
function leafTypeOf(type: string): "string" | "number" | "boolean" | "any" | "never" | "function" {
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "never":
      return "never";
    default:
      return "any";
  }
}

/**
 * 投影一个 schema 节点。
 * @param schema - rehydrate 之后的 volatile 表单 schema（或它的子节点）。
 * @param path - 该节点相对段根的路径；动态子节点由调用方给占位段。
 * @returns 渲染层要的字段树。
 */
export function projectNode(schema: SchemaNode, path: readonly string[] = []): FieldNode {
  return project(schema, path, []);
}

function project(
  schema: SchemaNode,
  path: readonly string[],
  ancestors: readonly SchemaNode[],
): FieldNode {
  const base: FieldNodeBase = {
    key: keyOf(path),
    path,
    label: undefined,
    meta: metaOf(schema),
    readOnly: null,
  };
  if (ancestors.includes(schema)) {
    return { ...base, type: "recursive", origin: schema.type };
  }
  const chain = [...ancestors, schema];
  switch (schema.type) {
    case "object": {
      const fields = Object.entries(schema.dict ?? {})
        .filter(([, child]) => child.meta?.hidden !== true)
        .map(([key, child]) => project(child, [...path, key], chain));
      return { ...base, type: "object", fields };
    }
    case "dict": {
      const segment = [...path, DYNAMIC_SEGMENT];
      const keyNode =
        schema.sKey === undefined
          ? stringLeaf(segment, emptyMeta())
          : project(schema.sKey, segment, chain);
      return {
        ...base,
        type: "dict",
        keyNode,
        valueNode: project(schema.inner ?? schema, segment, chain),
      };
    }
    case "array": {
      const item = project(schema.inner ?? schema, [...path, DYNAMIC_SEGMENT], chain);
      return { ...base, type: "array", item, mergeKey: mergeKeyOf(schema, item) };
    }
    case "tuple": {
      const items = (schema.list ?? []).map((child, index) =>
        project(child, [...path, String(index)], chain),
      );
      return { ...base, type: "tuple", items };
    }
    case "union": {
      const members = schema.list ?? [];
      const variants = members.map((child) => project(child, path, chain));
      const literals = members.every((child) => child.type === "const")
        ? members.map((child) => child.value)
        : undefined;
      return {
        ...base,
        type: "union",
        choices: literals,
        variants,
        tagKey: tagKeyOf(schema, variants),
      };
    }
    case "intersect": {
      return {
        ...base,
        type: "intersect",
        members: (schema.list ?? []).map((child) => project(child, path, chain)),
      };
    }
    case "bitset": {
      const bits = Object.entries(schema.bits ?? {}).map(([name, bit]) => ({ name, bit }));
      return { ...base, type: "bitset", bits };
    }
    case "const": {
      return { ...base, type: "const", value: schema.value };
    }
    case "transform": {
      const projected = project(schema.inner ?? schema, path, chain);
      return { ...projected, meta: mergeMeta(projected.meta, base.meta), readOnly: "transform" };
    }
    case "lazy": {
      const inner = schema.inner;
      return inner === undefined
        ? { ...base, type: "any" }
        : { ...base, type: "lazy", inner: project(inner, path, chain) };
    }
    case "is": {
      return { ...base, type: "any", readOnly: "constructor" };
    }
    default: {
      return {
        ...base,
        type: leafTypeOf(schema.type),
        readOnly: schema.type === "function" ? "function" : null,
      };
    }
  }
}

/** 展开 `lazy` 包装：投影里 lazy 只是一层，值仍在同一路径上。 */
export function unwrapLazy(node: FieldNode | undefined): FieldNode | undefined {
  let current = node;
  while (current?.type === "lazy") current = current.inner;
  return current;
}

/** 某一层可见的字段：object 直接给；union / intersect 把各变体的对象字段并起来。 */
export function fieldsOf(node: FieldNode | undefined): readonly FieldNode[] {
  const current = unwrapLazy(node);
  switch (current?.type) {
    case "object":
      return current.fields;
    case "union":
      return current.variants.flatMap((variant) => fieldsOf(variant));
    case "intersect":
      return current.members.flatMap((member) => fieldsOf(member));
    default:
      return [];
  }
}

/**
 * 按具体路径找回投影节点（动态段匹配真实键或索引）。
 * @param root - 段根的字段树。
 * @param path - 具体路径。
 * @returns 命中的节点，或 `undefined`。
 */
export function seekNode(root: FieldNode, path: readonly string[]): FieldNode | undefined {
  let current: FieldNode | undefined = root;
  for (const segment of path) {
    const node = unwrapLazy(current);
    if (node === undefined) return undefined;
    switch (node.type) {
      case "object":
      case "union":
      case "intersect":
        current = fieldsOf(node).find((field) => field.key === segment);
        break;
      case "dict":
        current = node.valueNode;
        break;
      case "array":
        current = node.item;
        break;
      case "tuple":
        current = node.items[Number(segment)];
        break;
      default:
        return undefined;
    }
  }
  return unwrapLazy(current);
}

/** 按当前值展开出的一个字段：路径与名字已按真实键与索引替换。 */
export interface WalkedField {
  path: readonly string[];
  node: FieldNode;
  /**
   * 这一行是某个动态容器的**成员本身**（dict 的键 / array 的项）时给出它的身份：容器路径、键、以及数组
   * 项的位置。渲染层用它画成员行（名字 + 移除）；成员的子字段不带这个标记。
   */
  member?: {
    parent: readonly string[];
    key: string;
    index: number | undefined;
  };
}

/** 候选键的来源（业务注册；见 `hints.ts`）：dict 的「可以加哪些键」。 */
export interface SuggestedKeys {
  /**
   * 读某个 dict 字段的候选键。
   * @param path - 该字段的具体路径。
   * @returns 候选键；没有就是空数组。
   */
  keysFor(path: readonly string[]): readonly string[];
}

/**
 * 按当前值把字段树展开成渲染顺序的扁平列表（前序）：容器在前、子项紧随其后。
 *
 * 出现的**只有值里有的东西，加上必填的**：对象的必填字段始终占行（值是空的也要让用户看见"必须填"），非必填的
 * 按值出现——值里没有就不占行，它在这一层的「添加属性」候选里，选中才加。数组按索引、字典按键展开；字面量
 * union 是叶子控件，对象 union 只展开与当前值匹配的那个变体，intersect 的各成员在同一层展开。
 * @param root - 段根的字段树。
 * @param value - 生效值（或草稿后的值）。
 * @returns 渲染顺序的字段列表。
 */
export function walkFields(root: FieldNode, value: unknown): WalkedField[] {
  const out: WalkedField[] = [];
  visit(root, root.path, value, out, true, undefined, new Set(), undefined);
  return out;
}

function visit(
  node: FieldNode,
  path: readonly string[],
  value: unknown,
  out: WalkedField[],
  emit: boolean,
  label: string | undefined,
  emitted: Set<string>,
  member: WalkedField["member"],
): void {
  const current = unwrapLazy(node);
  if (current === undefined) return;
  // 动态成员：名字换成真实键（投影时那里是占位段），数组项优先用项身份当显示名。
  const positioned = {
    ...current,
    path,
    ...(member === undefined ? {} : { key: member.key }),
    ...(label === undefined ? {} : { label }),
  } as FieldNode;
  const key = JSON.stringify(path);
  // 相交成员常描述同一个字段（共享层的选择器与分支里的 const 标记）：同一路径只发一次，
  // 先出现的那个留下（声明顺序上它就是共享层那份），子节点照常展开。
  if (emit && !emitted.has(key)) {
    emitted.add(key);
    out.push({ path, node: positioned, ...(member === undefined ? {} : { member }) });
  }
  switch (positioned.type) {
    case "object": {
      for (const field of positioned.fields) {
        const child = memberOf(value, field.key);
        // 必填字段始终占行（值还没有也要看得见"必须填"）；非必填的没值就不占行，它进「添加属性」候选
        // （见 `controller.ts` 的 `addableAt`）。
        if (child === undefined && field.meta.required !== true) continue;
        visit(field, [...path, field.key], child, out, true, undefined, emitted, undefined);
      }
      return;
    }
    case "dict": {
      for (const [key, child] of entriesOf(value)) {
        visit(positioned.valueNode, [...path, key], child, out, true, undefined, emitted, {
          parent: path,
          key,
          index: undefined,
        });
      }
      return;
    }
    case "array": {
      for (const [key, child] of entriesOf(value)) {
        const label =
          positioned.mergeKey === undefined ? undefined : memberLabel(child, positioned.mergeKey);
        visit(positioned.item, [...path, key], child, out, true, label, emitted, {
          parent: path,
          key,
          index: Number(key),
        });
      }
      return;
    }
    case "tuple": {
      positioned.items.forEach((item, index) => {
        visit(
          item,
          [...path, String(index)],
          memberOf(value, index),
          out,
          true,
          undefined,
          emitted,
          undefined,
        );
      });
      return;
    }
    case "union": {
      if (positioned.choices !== undefined) return;
      const variant = pickVariant(positioned, value);
      if (variant !== undefined)
        visit(variant, path, value, out, false, undefined, emitted, member);
      return;
    }
    case "intersect": {
      for (const part of positioned.members) {
        visit(part, path, value, out, false, undefined, emitted, member);
      }
      return;
    }
    default:
      return;
  }
}

/** 数组的项身份：显式声明优先，否则 item 上的 `id` 字段。 */
function mergeKeyOf(schema: SchemaNode, item: FieldNode): string | undefined {
  const declared = declaredExtra(schema, "mergeKey");
  if (declared !== undefined) return declared;
  const current = unwrapLazy(item);
  return current?.type === "object" && current.fields.some((field) => field.key === "id")
    ? "id"
    : undefined;
}

/** union 的判别标签：显式声明优先，否则所有对象成员共有的唯一常量字段。 */
function tagKeyOf(schema: SchemaNode, variants: readonly FieldNode[]): string | undefined {
  const declared = declaredExtra(schema, "tag");
  if (declared !== undefined) return declared;
  const members = variants.map((variant) => unwrapLazy(variant));
  if (members.length === 0 || members.some((member) => member?.type !== "object")) return undefined;
  const objects = members as (FieldNode & { type: "object" })[];
  const candidates = (objects[0]?.fields ?? [])
    .map((field) => unwrapLazy(field))
    .filter((field): field is FieldNode & { type: "const" } => field?.type === "const")
    .map((field) => field.key)
    .filter((key) =>
      objects.every(
        (object) => unwrapLazy(object.fields.find((field) => field.key === key))?.type === "const",
      ),
    );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** `role(text, { … })` 里声明的字符串约定（项身份 `mergeKey`、判别标签 `tag`）。 */
function declaredExtra(schema: SchemaNode, name: string): string | undefined {
  const extra = schema.meta?.extra;
  if (typeof extra !== "object" || extra === null) return undefined;
  const value: unknown = Reflect.get(extra, name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 一项的项身份值（渲染与冲突检查共用的读法）。 */
function memberLabel(value: unknown, mergeKey: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const member: unknown = Reflect.get(value, mergeKey);
  if (typeof member === "string") return member;
  if (typeof member === "number" && Number.isFinite(member)) return String(member);
  return undefined;
}

/** 项身份的一处冲突。 */
export interface MergeKeyConflict {
  /** `duplicate`：两个成员同名；`missing`：成员没有名字。 */
  kind: "duplicate" | "missing";
  /** 冲突成员的具体路径。 */
  path: readonly string[];
  /** 判据用的字段名。 */
  mergeKey: string;
  /** 那个名字（缺名字时是空串）。 */
  value: string;
}

/**
 * 项身份冲突：同一层里两个成员同名，或某个成员没有名字。
 *
 * 名字是成员的「身份」，写盘仍按索引——所以这只是保存前的本地校验：重名的数组在页面上是非法草稿，
 * 而不是悄悄写到 host 上。
 * @param root - 段根的字段树。
 * @param value - 草稿后的段值。
 * @returns 第一处冲突，或 `undefined`。
 */
export function mergeKeyConflict(root: FieldNode, value: unknown): MergeKeyConflict | undefined {
  return scanConflict(root, root.path, value);
}

function scanConflict(
  node: FieldNode,
  path: readonly string[],
  value: unknown,
): MergeKeyConflict | undefined {
  const current = unwrapLazy(node);
  if (current === undefined) return undefined;
  switch (current.type) {
    case "object": {
      for (const field of current.fields) {
        const conflict = scanConflict(field, [...path, field.key], memberOf(value, field.key));
        if (conflict !== undefined) return conflict;
      }
      return undefined;
    }
    case "dict": {
      for (const [key, child] of entriesOf(value)) {
        const conflict = scanConflict(current.valueNode, [...path, key], child);
        if (conflict !== undefined) return conflict;
      }
      return undefined;
    }
    case "array": {
      const names = new Set<string>();
      for (const [key, child] of entriesOf(value)) {
        const itemPath = [...path, key];
        if (current.mergeKey !== undefined) {
          const label = memberLabel(child, current.mergeKey);
          if (label === undefined || label.trim() === "") {
            return { kind: "missing", path: itemPath, mergeKey: current.mergeKey, value: "" };
          }
          if (names.has(label)) {
            return { kind: "duplicate", path: itemPath, mergeKey: current.mergeKey, value: label };
          }
          names.add(label);
        }
        const conflict = scanConflict(current.item, itemPath, child);
        if (conflict !== undefined) return conflict;
      }
      return undefined;
    }
    case "tuple": {
      for (const [index, item] of current.items.entries()) {
        const conflict = scanConflict(item, [...path, String(index)], memberOf(value, index));
        if (conflict !== undefined) return conflict;
      }
      return undefined;
    }
    case "union": {
      if (current.choices !== undefined) return undefined;
      const variant = pickVariant(current, value);
      return variant === undefined ? undefined : scanConflict(variant, path, value);
    }
    case "intersect": {
      for (const member of current.members) {
        const conflict = scanConflict(member, path, value);
        if (conflict !== undefined) return conflict;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** 一个容器值里的成员（对象键或数组索引）。 */
function entriesOf(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  if (typeof value === "object" && value !== null) return Object.entries(value);
  return [];
}

/** 读一个成员的值。 */
function memberOf(value: unknown, key: string | number): unknown {
  if (Array.isArray(value)) return value[Number(key)];
  if (typeof value === "object" && value !== null)
    return (value as Record<string, unknown>)[String(key)];
  return undefined;
}

/** union 的变体切换：一个选项要写的值。 */
export interface VariantChoice {
  /** 页面上显示的名字：判别标签的值，或变体的形状。 */
  label: string;
  /** 写这个值就等于选中这一支。 */
  value: unknown;
}

/** 把节点收成 union：渲染层判形状与选支都从这里进。 */
export function unionOf(node: FieldNode | undefined): (FieldNode & { type: "union" }) | undefined {
  const current = unwrapLazy(node);
  return current?.type === "union" ? current : undefined;
}

/**
 * 当前值落在哪一支：与 {@link walkFields} 的展开同一判据（标签值优先，其次值的形状，最后第一支）。
 * @param node - 字段节点（不是 union 就原样返回）。
 * @param value - 这一层的值。
 * @returns 选中变体的节点。
 */
export function variantOf(node: FieldNode, value: unknown): FieldNode {
  const union = unionOf(node);
  if (union === undefined) return unwrapLazy(node) ?? node;
  return pickVariant(union, value) ?? union;
}

/** 变体里那个判别标签字段的常量值（不是 `const` 就没有）。 */
function tagValueOf(variant: FieldNode, tagKey: string): { found: boolean; value: unknown } {
  const current = unwrapLazy(variant);
  if (current?.type !== "object" && current?.type !== "intersect") {
    return { found: false, value: undefined };
  }
  for (const field of fieldsOf(current)) {
    if (field.key !== tagKey) continue;
    const candidate = unwrapLazy(field);
    if (candidate?.type === "const") return { found: true, value: candidate.value };
  }
  return { found: false, value: undefined };
}

/** 一个变体在页面上的名字：能看出"这一支是什么"，而不是内部类型名。 */
function variantLabel(variant: FieldNode, tag: { found: boolean; value: unknown }): string {
  if (tag.found) return JSON.stringify(tag.value);
  switch (unwrapLazy(variant)?.type) {
    case "string":
      return '""';
    case "number":
      return "0";
    case "boolean":
      return "true";
    case "array":
    case "tuple":
      return "[ ]";
    case "object":
    case "dict":
    case "intersect":
      return "{ }";
    default:
      return unwrapLazy(variant)?.type ?? "any";
  }
}

/**
 * 变体切换的选项。
 *
 * 带判别标签的 union 写**标签值**（`session-rdb` 的 `type: sqlite` ↔ `type: postgres`）；没有标签的写目标变体的
 * 空值（`access` 在「一段文本」与「一组文本」之间切）。
 * @param union - 投影出来的 union 节点。
 * @returns 每个变体一项，顺序即声明顺序。
 */
export function variantChoices(union: FieldNode & { type: "union" }): readonly VariantChoice[] {
  return union.variants.map((variant) => {
    const tag =
      union.tagKey === undefined
        ? { found: false, value: undefined }
        : tagValueOf(variant, union.tagKey);
    return {
      label: variantLabel(variant, tag),
      value: tag.found ? tag.value : emptyValueOf(variant),
    };
  });
}

/** 按路径读一个值：对象键与数组下标都认（值的读法只有这一处）。 */
export function readPath(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, segment) => {
    if (Array.isArray(node)) return node[Number(segment)];
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Record<string, unknown>)[segment];
  }, root);
}

/**
 * schemastery 给容器类型自动塞的空壳默认（`{}`）——它不是"用户声明的默认值"，别拿它当初值用。
 * @param node - 字段节点。
 * @returns 是不是那种空壳。
 */
function isImplicitEmptyDefault(node: FieldNode): boolean {
  if (node.type !== "object" && node.type !== "intersect") return false;
  const value = node.meta.defaultValue;
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/**
 * 一个新子节点的初值：声明的默认值优先；对象把字段摆出来（见下）；字典/数组给空的容器；其余标量给 **`null`**。
 *
 * `null` 在这里是"还没有值"的判断位（`null` / `undefined` 都算），页面据此把它画成一个等着输入的位子——
 * 而不是 `""`、`0` 这种看着像已经填过的值。host 侧也认这个语义：非必填字段拿到 `null` 回退到默认值，
 * 必填字段拿到 `null` 就是"必须填"。
 * @param node - 子节点的字段树。
 * @returns 初值。
 */
export function emptyValueOf(node: FieldNode): unknown {
  if (node.meta.hasDefault && !isImplicitEmptyDefault(node)) {
    return structuredClone(node.meta.defaultValue);
  }
  switch (node.type) {
    case "array":
      return [];
    case "tuple":
      return node.items.map((item) => emptyValueOf(item));
    case "dict":
      return {};
    case "object":
    case "intersect":
      // 新加进来的对象：把它的字段都摆出来（标量给 `null` = "还没填"，容器给空的容器）。加成之后直接看到要填
      // 什么——否则是一个空对象，用户还得逐个从"添加属性"候选里再挑一遍。
      return Object.fromEntries(fieldsOf(node).map((field) => [field.key, emptyValueOf(field)]));
    case "const":
      return node.value;
    case "bitset":
      return 0;
    case "lazy":
      return emptyValueOf(node.inner);
    default:
      return null;
  }
}

/** 选中与当前值匹配的 union 变体：对象按判别标签的值判，叶子按值类型判。 */
function pickVariant(node: FieldNode & { type: "union" }, value: unknown): FieldNode | undefined {
  if (
    node.tagKey !== undefined &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const tagValue: unknown = Reflect.get(value, node.tagKey);
    for (const variant of node.variants) {
      const current = unwrapLazy(variant);
      if (current?.type !== "object") continue;
      const field = unwrapLazy(current.fields.find((candidate) => candidate.key === node.tagKey));
      if (field?.type === "const" && field.value === tagValue) return variant;
    }
  }
  for (const variant of node.variants) {
    const current = unwrapLazy(variant);
    if (current?.type === "string" && typeof value === "string") return variant;
    if (current?.type === "number" && typeof value === "number") return variant;
    if (current?.type === "boolean" && typeof value === "boolean") return variant;
    if (current?.type === "array" && Array.isArray(value)) return variant;
  }
  return node.variants[0];
}

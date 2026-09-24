/**
 * 行模型：把字段树（`walkFields` 的结果）排成**编辑器的行**——结构行（`{` / `[` / `}` / `]`）、字段行、注释行、
 * 以及容器尾部的添加行。
 *
 * 渲染层因此只按行画，不必自己递归：行序 = 视觉顺序，行号连续。折叠在这里生效（折叠的容器只留开启行）。
 */

import { fieldKey, type AddableProperty, type SchemaFormState } from "./controller.ts";
import type { DraftFieldState } from "./draft.ts";
import type { ResolveText } from "./labels.ts";
import { fieldHint } from "./labels.ts";
import type { SchemaFormTranslate } from "./slot-contract.ts";
import {
  unionOf,
  unwrapLazy,
  variantChoices,
  variantOf,
  type FieldNode,
  type VariantChoice,
  type WalkedField,
} from "./schema-node.ts";

/** 一个容器的闭合行后面能加什么。 */
export type AddLineSpec =
  /** 数组：追加一个空项。 */
  | { kind: "item" }
  /** 字典：敲键名，或从候选键里选（业务注册的读数）。 */
  | { kind: "key"; options: readonly AddableProperty[] }
  /** 对象：从「schema 声明了、值里还没有」的字段里选（没有候选项时不给输入框）。 */
  | { kind: "prop"; options: readonly AddableProperty[] };

/** 一行上的变体切换控件。 */
export interface VariantControl {
  /** 可以切到哪几支；顺序即声明顺序。 */
  choices: readonly VariantChoice[];
  /** 当前落在第几支。 */
  selected: number;
}

/** 容器类型：结构行用 `{` 还是 `[`。 */
export type ContainerShape = "object" | "array";

/** 一行。 */
export type EditorLine =
  /** 容器的开启行：`key: {` 或 `[`。 */
  | {
      kind: "open";
      path: readonly string[];
      node: FieldNode;
      shape: ContainerShape;
      depth: number;
      collapsed: boolean;
      member: WalkedField["member"];
      /** 这一层是 union 时，可以在哪几支之间切（写哪个值）。 */
      variants: VariantControl | undefined;
    }
  /** 容器的关闭行：`}` / `]`（添加行挂在它后面同一行）。 */
  | {
      kind: "close";
      path: readonly string[];
      node: FieldNode;
      shape: ContainerShape;
      depth: number;
      /** 这一层能加什么；`undefined` 表示加不了（对象的声明字段都配齐了）。 */
      add: AddLineSpec | undefined;
      member: WalkedField["member"];
    }
  /** 字段行：`key: value`。 */
  | {
      kind: "field";
      path: readonly string[];
      node: FieldNode;
      depth: number;
      field: DraftFieldState;
      member: WalkedField["member"];
      /** 这个字段是 union 时，可以在哪几支之间切。 */
      variants: VariantControl | undefined;
      /**
       * 变体触发**代替这一行的值**：判别式 union 的标签行就是这样——`type: "sqlite" ▾` 里的值就是那个触发，
       * 不再另画一份值。
       */
      variantsStandIn: boolean;
    }
  /** 注释行：schema 的说明与业务给的文案，画在字段行上方。 */
  | {
      kind: "comment";
      path: readonly string[];
      depth: number;
      text: string;
    };

/**
 * 容器的形状：对象类用 `{}`，序列类用 `[]`。
 *
 * union 没有自己的形状——它跟着**当前选中那一支**走（`access` 是数组就在页面上画 `[`），这也是
 * `access: string | string[]` 这类字段以前被画成对象容器的原因。
 * @param node - 字段节点。
 * @param value - 这一层的值（选支判据）。
 * @returns 形状；叶子节点是 `undefined`。
 */
export function containerShape(node: FieldNode, value?: unknown): ContainerShape | undefined {
  switch (variantOf(node, value).type) {
    case "object":
    case "dict":
    case "intersect":
      return "object";
    case "array":
    case "tuple":
      return "array";
    default:
      return undefined;
  }
}

/** 折叠状态与可见性：记「用户切换过的路径」，开合 = 切换过就反转 schema 的默认值。 */
export interface FoldState {
  collapsed(path: readonly string[]): boolean;
  toggle(path: readonly string[]): void;
}

/** 渲染顺序里可见的字段：折叠的容器把整棵子树滤掉，只留它自己的开启行。 */
export function visibleFields(state: SchemaFormState, fold: FoldState): readonly WalkedField[] {
  const containers = new Set(
    state.walked
      .filter((item) => containerShape(item.node, valueAt(state, item.path)) !== undefined)
      .map((item) => fieldKey(item.path)),
  );
  return state.walked.filter((item) => {
    for (let depth = 1; depth < item.path.length; depth++) {
      const ancestor = item.path.slice(0, depth);
      if (containers.has(fieldKey(ancestor)) && fold.collapsed(ancestor)) return false;
    }
    return true;
  });
}

/** 这一层的当前值：与字段行显示的是同一份读数（草稿优先）。 */
function valueAt(state: SchemaFormState, path: readonly string[]): unknown {
  return state.fields.get(fieldKey(path))?.value;
}

/** 这一层能加什么：数组追加空项，字典敲键名（可来自候选），对象从还没配的声明字段里选。 */
function addOf(
  node: FieldNode,
  shape: ContainerShape,
  options: readonly AddableProperty[],
): AddLineSpec | undefined {
  if (shape === "array") return { kind: "item" };
  if (unwrapLazy(node)?.type === "dict") return { kind: "key", options };
  return options.length === 0 ? undefined : { kind: "prop", options };
}

/** 一个节点上的变体切换控件：不是 union、或只有一支、或成员全是常量（字面量集合是选择器）时没有。 */
function variantsOf(node: FieldNode, value: unknown): VariantControl | undefined {
  const union = unionOf(node);
  if (union === undefined || union.choices !== undefined || union.variants.length < 2)
    return undefined;
  return {
    choices: variantChoices(union),
    selected: union.variants.indexOf(variantOf(union, value)),
  };
}

/**
 * 排成行序列。
 * @param state - 页面读数。
 * @param fold - 折叠状态。
 * @param resolveText - `description` 的本地化。
 * @param t - 本包字典。
 * @returns 行序列（行号即下标）。
 */
export function editorLines(
  state: SchemaFormState,
  fold: FoldState,
  resolveText: ResolveText,
  t: SchemaFormTranslate,
): EditorLine[] {
  const lines: EditorLine[] = [];
  const open: {
    path: readonly string[];
    node: FieldNode;
    shape: ContainerShape;
    depth: number;
    add: AddLineSpec | undefined;
    member: WalkedField["member"];
  }[] = [];
  const closeOpenUntil = (path: readonly string[]): void => {
    while (open.length > 0) {
      const top = open[open.length - 1]!;
      if (isPrefix(top.path, path)) return;
      open.pop();
      lines.push({
        kind: "close",
        path: top.path,
        node: top.node,
        shape: top.shape,
        depth: top.depth,
        add: top.add,
        member: top.member,
      });
    }
  };
  for (const item of visibleFields(state, fold)) {
    closeOpenUntil(item.path);
    const node = unwrapLazy(item.node) ?? item.node;
    const value = valueAt(state, item.path);
    // 层级从根算起：根的 `{` 是 0，第一层字段就是 1——第一层也缩进一格。
    const depth = item.path.length;
    const comment = commentFor(state, item, resolveText, t);
    if (comment !== undefined) {
      lines.push({ kind: "comment", path: item.path, depth, text: comment });
    }
    const variants = variantsOf(node, value);
    const shape = containerShape(node, value);
    if (shape !== undefined) {
      const collapsed = fold.collapsed(item.path);
      const add = addOf(node, shape, state.addable.get(fieldKey(item.path)) ?? []);
      lines.push({
        kind: "open",
        path: item.path,
        node,
        shape,
        depth,
        collapsed,
        member: item.member,
        variants,
      });
      // 折叠的容器用 `{…}` 收在一行里：它不再有子行，也没有自己的关闭行。
      if (!collapsed) {
        open.push({ path: item.path, node, shape, depth, add, member: item.member });
      }
      continue;
    }
    lines.push({
      kind: "field",
      path: item.path,
      node,
      depth,
      field: state.fields.get(fieldKey(item.path)) ?? {
        value: undefined,
        text: undefined,
        invalid: undefined,
        overridden: false,
        staged: false,
      },
      member: item.member,
      variants,
      variantsStandIn: false,
    });
  }
  while (open.length > 0) {
    const top = open.pop()!;
    lines.push({
      kind: "close",
      path: top.path,
      node: top.node,
      shape: top.shape,
      depth: top.depth,
      add: top.add,
      member: top.member,
    });
  }
  return moveVariantControlToTag(lines);
}

/**
 * 判别式 union 的切换控件挪到**标签字段那一行**上：`session-rdb` 的页面上用户改的就是 `type`，把它放在容器
 * 行上等于让人在两处看同一件事。没有标签字段（`access` 这种按值形状选的）就留在 union 自己那一行。
 */
function moveVariantControlToTag(lines: EditorLine[]): EditorLine[] {
  for (const line of lines) {
    if (line.kind === "comment" || line.kind === "close") continue;
    if (line.variants === undefined) continue;
    const tagKey = unionOf(line.node)?.tagKey;
    if (tagKey === undefined) continue;
    const tagPath = [...line.path, tagKey];
    const tagLine = lines.find(
      (candidate) =>
        candidate.kind === "field" &&
        candidate.path.length === tagPath.length &&
        candidate.path.every((segment, index) => segment === tagPath[index]),
    );
    if (tagLine === undefined || tagLine.kind !== "field") continue;
    // 标签行：值位置直接画那个切换控件（值是 const，本来就改不了）。
    tagLine.variants = line.variants;
    tagLine.variantsStandIn = true;
    line.variants = undefined;
  }
  return lines;
}

/** 一行的注释：业务给的文案（字段槽的 label/hint）优先，其次 schema 的说明。 */
function commentFor(
  state: SchemaFormState,
  item: WalkedField,
  resolveText: ResolveText,
  t: SchemaFormTranslate,
): string | undefined {
  const node = unwrapLazy(item.node) ?? item.node;
  const parts: string[] = [];
  // 注释放"这是什么"（说明）与只读、徽标这类一眼看不出的状态，不放"必填"这类结构信息——那是 schema 的常规。
  // 业务经提示面给的文案优先，schema 的 `description` / `comment` 兜底。
  const text = state.texts.get(fieldKey(item.path));
  const hint =
    [text?.label, text?.hint].filter((part) => part !== undefined && part !== "").join("：") ||
    fieldHint(node, resolveText);
  if (hint !== undefined && hint !== "") parts.push(hint);
  // 只读的字段（装配事实这类）要说清楚为什么改不了，否则看起来只是"点不开"。
  if (node.meta.disabled) parts.push(t("readOnlyField"));
  if (node.meta.badges.length > 0) parts.push(node.meta.badges.join(" / "));
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** `path` 是不是 `prefix` 的后代（含自身）。 */
function isPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, index) => path[index] === segment);
}

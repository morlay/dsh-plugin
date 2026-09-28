/**
 * 暂存式草稿模型：把用户在这一页上的编辑收成一组 path op，保存时一次提交。
 *
 * 每次保存都是 host 上一次带 revision 栅栏的持久写，所以控件**不直接写盘**：编辑先落在草稿上（屏幕上看到的
 * 就是要保存的内容），`save()` 是唯一的写盘点，且先过一遍整段校验——schema 挡下的值不发请求。字段的「已覆盖」
 * 由用户层的 presence 决定（覆盖值恰好等于默认值也是覆盖），不是值比较。
 *
 * 与渲染无关：控件读 `field(path)`、调 `set/setText/clear/appendItem/…`；文案与控件形状在 `fields/`。
 */

import type { SettingsPathOpView } from "@deepseek-ai/dsh-api-remotes/client";
import { createSnapshotStore, type SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { ConfigForm, ConfigFormSnapshot } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { SettingsFormShell } from "@deepseek-ai/dsh-client-ui-primitives";
import { emptyValueOf, fieldsOf, readPath, seekNode, type FieldNode } from "./schema-node.ts";

/** 命名空间段（一段配置）的值。 */
export type Section = Record<string, unknown>;

/** 文本草稿的解析结果：控件把用户输入交给保存那一刻解析。 */
export type TextParseResult =
  /** 得到一个值。 */
  | { kind: "value"; value: unknown }
  /** 这段文本不产生写（例如 secret 留空＝保留已存的值）。 */
  | { kind: "skip" }
  /** 不是这个字段接受的值：留在屏幕上并挡住保存。 */
  | { kind: "invalid"; message: string };

/** 控件给文本草稿的解析规则。 */
export type TextParse = (text: string) => TextParseResult;

/** 整段校验失败：消息 + 它落在哪一层（页面把消息画在**出错的那一行**上）。 */
export interface ValidationFailure {
  /** 面向用户的消息（已去掉 schemastery 拼的 `$…` 位置前缀）。 */
  message: string;
  /** 具体路径（段根起）；空数组表示错误在整段上。 */
  path: readonly string[];
}

/**
 * 把校验器抛出的错误收成一条失败。
 *
 * schemastery 的 `ValidationError` 把路径留在 `options.path` 上（消息里的 `$…` 前缀是给命令行看的），所以这里
 * 取路径、去前缀——行内报错据此知道挂在哪一行。
 * @param error - 校验器抛出的错误。
 * @returns 消息与路径。
 */
export function failureOf(error: unknown): ValidationFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const options = (error as { options?: { path?: readonly (string | number | symbol)[] } }).options;
  const path = (options?.path ?? [])
    .filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    )
    .map(String);
  const message = raw.replace(/^\$\S*\s/, "").trim();
  return { message: message === "" ? raw : message, path };
}

/** 一字段的草稿。 */
type DraftEdit =
  /** 控件已经给出合法值（开关、选择器、数字步进、增删项）。 */
  | { kind: "value"; value: unknown }
  /** 文本输入：`parse` 在保存时跑，解析失败挡住保存。 */
  | { kind: "text"; text: string; parse: TextParse }
  /** 恢复默认：把字段交回组成层（用户层没有它时不算写）。 */
  | { kind: "clear" }
  /** 移除：无条件 unset（数组项与字典键，host 语义是删掉这一项）。 */
  | { kind: "drop" };

/** 一字段渲染时要读的状态。 */
export interface DraftFieldState {
  /** 控件要显示的值：草稿优先，否则生效层。 */
  value: unknown;
  /** 文本草稿（文本控件显示它而不是重新格式化值）。 */
  text: string | undefined;
  /** 草稿不合法时的消息（控件显示，同时挡住保存）。 */
  invalid: string | undefined;
  /** 保存后这一字段是否会留下用户层条目。 */
  overridden: boolean;
  /** 这一字段在本页有还没保存的编辑（页面上给它一处高亮与一个「撤回」）。 */
  staged: boolean;
}

/** 模型要读要写的那个命名空间。 */
export type DraftScope = ConfigForm<Section>;

/** 构造参数。 */
export interface SchemaDraftOptions {
  scope: DraftScope;
  /** 段根的字段树（`projectNode` 的结果）：增删项要按它取节点默认值。 */
  root: FieldNode;
  /** 整段校验：返回失败（消息 + 位置），或 `undefined`。 */
  validate: (value: Section) => ValidationFailure | undefined;
}

/** 一条草稿编辑要写的 op（`undefined` 表示这条草稿不该产生写）。 */
interface PlannedWrite {
  op: SettingsPathOpView | undefined;
}

/**
 * 一页配置的草稿。一个命名空间一个实例：它订阅共享配置表单，投影给渲染层读。
 */
export class SchemaDraftModel {
  readonly #scope: DraftScope;
  #root: FieldNode;
  readonly #validate: (value: Section) => ValidationFailure | undefined;
  readonly #staged = new Map<string, { path: readonly string[]; edit: DraftEdit }>();
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribe: () => void;
  #baseline: ConfigFormSnapshot<Section> | undefined;
  #saving = false;
  #failed = false;
  #violation: ValidationFailure | undefined;

  /**
   * @param options - 本页的共享配置表单、字段树与整段校验。
   */
  constructor(options: SchemaDraftOptions) {
    this.#scope = options.scope;
    this.#root = options.root;
    this.#validate = options.validate;
    this.#unsubscribe = this.#scope.subscribe(() => {
      this.#publish();
    });
  }

  /**
   * 换一份字段树。
   *
   * 增删项要按它取节点默认值，而 schema 可能随 describe 变（行的 Config 改了）——所以控制器每次投影都同步一次，
   * 否则加进来的项会取不到默认值。
   * @param root - 段根的字段树。
   */
  setRoot(root: FieldNode): void {
    this.#root = root;
  }

  /**
   * 观察草稿与读数的变化。
   * @param listener - 每次投影都调一次的回调。
   * @returns 取消订阅。
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * 投影一份读数给渲染层。
   * @param project - 用模型的当前读数造渲染要的状态。
   * @returns 渲染层按选择器读的 store。
   */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project());
    this.subscribe(() => {
      store.set(project());
    });
    return store;
  }

  /**
   * 表单级状态（与上游 `SettingsForm` 的壳同形）。
   * @returns 可用性、可写性、脏、非法、保存中、上次保存失败。
   */
  shell(): SettingsFormShell {
    const { writes, blocked } = this.#plan();
    return {
      available: this.#scope.getSnapshot().status === "ready",
      writable: this.#scope.getSnapshot().writable,
      dirty: writes.some((item) => item.op !== undefined) || blocked,
      invalid: blocked || this.#violation !== undefined,
      saving: this.#saving,
      failed: this.#failed,
    };
  }

  /**
   * 保存前的整段校验（保存被 schema 挡下时非空）。
   * @returns 失败消息与它的位置，或 `undefined`。
   */
  violation(): ValidationFailure | undefined {
    return this.#violation;
  }

  /**
   * 读一个字段的草稿状态。
   * @param path - 具体路径（动态段已按真实键或索引替换）。
   * @param preview - 本轮已经算好的读数（`preview()` 的结果）。
   *
   * **容器的值要跟着别处的草稿走**：判别式 union 的选支就是容器的值，若这里读生效层，`type` 的切换控件会显示旧
   * 的那一支（字段树却已经换了）。所以有 `preview` 就用它——控制器一次投影里只算一份。
   * @returns 显示值、文本草稿、非法消息、是否覆盖。
   */
  field(path: readonly string[], preview?: Section): DraftFieldState {
    const snapshot = this.#scope.getSnapshot();
    const staged = this.#staged.get(pathKey(path));
    const stored = hasPath(snapshot.user, path);
    if (staged === undefined) {
      return {
        value: readPath(preview ?? snapshot.value, path),
        text: undefined,
        invalid: undefined,
        overridden: stored,
        staged: false,
      };
    }
    switch (staged.edit.kind) {
      case "value":
        return {
          value: staged.edit.value,
          text: undefined,
          invalid: undefined,
          overridden: true,
          staged: true,
        };
      case "text": {
        const parsed = staged.edit.parse(staged.edit.text);
        return {
          value: parsed.kind === "value" ? parsed.value : readPath(snapshot.value, path),
          text: staged.edit.text,
          invalid: parsed.kind === "invalid" ? parsed.message : undefined,
          overridden: true,
          staged: true,
        };
      }
      case "clear":
        return {
          value: readPath(snapshot.base, path),
          text: undefined,
          invalid: undefined,
          overridden: false,
          staged: true,
        };
      case "drop":
        return {
          value: undefined,
          text: undefined,
          invalid: undefined,
          overridden: false,
          staged: true,
        };
    }
  }

  /**
   * 暂存一个合法值。
   * @param path - 具体路径。
   * @param value - 控件给出的值。
   */
  set(path: readonly string[], value: unknown): void {
    this.#stage(path, { kind: "value", value });
  }

  /**
   * 暂存一段文本，保存时才解析。
   * @param path - 具体路径。
   * @param text - 用户输入的原文。
   * @param parse - 解析规则；失败时给出消息并挡住保存。
   */
  setText(path: readonly string[], text: string, parse: TextParse): void {
    this.#stage(path, { kind: "text", text, parse });
  }

  /**
   * 暂存「恢复默认」。
   * @param path - 具体路径。
   */
  clear(path: readonly string[]): void {
    this.#stage(path, { kind: "clear" });
  }

  /**
   * 追加一个数组项，值取该项节点的默认值。
   * @param path - 数组字段的具体路径。
   */
  appendItem(path: readonly string[]): void {
    const node = seekNode(this.#root, path);
    if (node?.type !== "array") return;
    const current = readPath(this.preview(), path);
    const index = Array.isArray(current) ? current.length : 0;
    this.set([...path, String(index)], emptyValueOf(node.item));
  }

  /**
   * 移除一个数组项。
   * @param path - 数组字段的具体路径。
   * @param index - 项在数组里的位置。
   */
  removeItem(path: readonly string[], index: number): void {
    this.#stage([...path, String(index)], { kind: "drop" });
  }

  /**
   * 给一层加一项，值取它的默认值。
   *
   * 字典认任意键；对象只认 schema 声明过的字段（写一个没声明的键会被 host 挡下，所以这里直接不写）。
   * @param path - 容器的具体路径。
   * @param key - 要加的键。
   */
  addKey(path: readonly string[], key: string): void {
    const node = seekNode(this.#root, path);
    if (node === undefined) return;
    if (node.type === "dict") {
      this.set([...path, key], emptyValueOf(node.valueNode));
      return;
    }
    const field = fieldsOf(node).find((candidate) => candidate.key === key);
    if (field === undefined) return;
    this.set([...path, key], emptyValueOf(field));
  }

  /**
   * 删一个字典键。
   * @param path - 字典字段的具体路径。
   * @param key - 要删的键。
   */
  removeKey(path: readonly string[], key: string): void {
    this.#stage([...path, key], { kind: "drop" });
  }

  /**
   * 撤销一个字段的草稿（回到它当前的生效值）——行内编辑取消时用。
   * @param path - 具体路径。
   */
  revert(path: readonly string[]): void {
    if (!this.#staged.delete(pathKey(path))) return;
    this.#failed = false;
    this.#violation = undefined;
    this.#publish();
  }

  /** 丢弃全部草稿，回到 host 的读数。 */
  discard(): void {
    if (this.#staged.size === 0 && !this.#failed && this.#violation === undefined) return;
    this.#staged.clear();
    this.#baseline = undefined;
    this.#failed = false;
    this.#violation = undefined;
    this.#publish();
  }

  /**
   * 把全部草稿写成一次带 revision 栅栏的提交。
   *
   * host 是「值是否被接受」的唯一权威（有些约束 schema 表达不出来），所以落盘与否读回来决定，而不是在这里
   * 预测；没落盘的保存保留草稿，让用户改而不是重打。
   * @returns 写完与读回之后的收束。
   */
  async save(): Promise<void> {
    const snapshot = this.#scope.getSnapshot();
    if (this.#saving || !snapshot.writable) return;
    const { writes, blocked } = this.#plan();
    if (blocked) return;
    const ops = writes.flatMap((item) => (item.op === undefined ? [] : [item.op]));
    if (ops.length === 0) {
      this.#violation = undefined;
      this.#publish();
      return;
    }
    const failure = this.#validate(applyOps(snapshot.value ?? {}, ops));
    if (failure !== undefined) {
      this.#violation = failure;
      this.#publish();
      return;
    }
    this.#violation = undefined;
    this.#saving = true;
    this.#failed = false;
    this.#publish();
    try {
      const landed = await this.#scope.mutate(ops, this.#baseline?.revision);
      if (landed) {
        this.#staged.clear();
        this.#baseline = undefined;
      }
      this.#failed = !landed;
    } catch {
      this.#failed = true;
    } finally {
      this.#saving = false;
      this.#publish();
    }
  }

  /** 释放对共享配置表单的订阅。 */
  dispose(): void {
    this.#unsubscribe();
    this.#listeners.clear();
  }

  /** 每条草稿这一轮会写什么；被 schema 挡下的草稿没有 op，但仍然是脏的。 */
  #plan(): { writes: PlannedWrite[]; blocked: boolean } {
    const snapshot = this.#scope.getSnapshot();
    const writes: PlannedWrite[] = [];
    let blocked = false;
    for (const { path, edit } of this.#staged.values()) {
      if (edit.kind === "drop") {
        writes.push({ op: { op: "unset", path: [...path] } });
        continue;
      }
      if (edit.kind === "clear") {
        if (hasPath(snapshot.user, path)) writes.push({ op: { op: "unset", path: [...path] } });
        continue;
      }
      const parsed =
        edit.kind === "value"
          ? { kind: "value" as const, value: edit.value }
          : edit.parse(edit.text);
      if (parsed.kind === "invalid") {
        blocked = true;
        continue;
      }
      if (parsed.kind === "skip") continue;
      const current = readPath(snapshot.value, path);
      if (sameValue(current, parsed.value)) continue;
      writes.push({ op: { op: "set", path: [...path], value: parsed.value as never } });
    }
    return { writes, blocked };
  }

  /** 生效值套上本轮草稿后的段值：字段树按它展开（追加的数组项立刻出现），整段校验也看它。 */
  preview(): Section {
    const ops = this.#plan().writes.flatMap((item) => (item.op === undefined ? [] : [item.op]));
    return applyOps(this.#scope.getSnapshot().value ?? {}, ops);
  }

  #stage(path: readonly string[], edit: DraftEdit): void {
    this.#baseline ??= this.#scope.getSnapshot();
    this.#staged.set(pathKey(path), { path: [...path], edit });
    this.#failed = false;
    this.#violation = undefined;
    this.#publish();
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** 深比较：值相等就不写（避免把「改回原值」也当成一次写）。 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null)
    return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 路径的 map 键。 */
function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

/** 路径末段是否在用户层里存在（覆盖判据）。 */
function hasPath(root: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return root !== undefined;
  const parent = readPath(root, path.slice(0, -1));
  const leaf = path[path.length - 1] ?? "";
  if (Array.isArray(parent)) return Number(leaf) < parent.length;
  if (typeof parent !== "object" || parent === null) return false;
  return leaf in parent;
}

/** 把一组 op 套到一个段值上（本地读数用，不写 host）。 */
function applyOps(section: Section, ops: readonly SettingsPathOpView[]): Section {
  const next = structuredClone(section);
  for (const op of ops) {
    const parent = readPath(next, op.path.slice(0, -1));
    const leaf = op.path[op.path.length - 1] ?? "";
    if (Array.isArray(parent)) {
      if (op.op === "set") parent[Number(leaf)] = op.value;
      else parent.splice(Number(leaf), 1);
      continue;
    }
    if (typeof parent !== "object" || parent === null) continue;
    if (op.op === "set") (parent as Section)[leaf] = op.value;
    else Reflect.deleteProperty(parent as Section, leaf);
  }
  return next;
}

/** 一个新子节点的初值：字段树的读法在 `schema-node.ts`（变体切换也要它）。 */
export { emptyValueOf } from "./schema-node.ts";

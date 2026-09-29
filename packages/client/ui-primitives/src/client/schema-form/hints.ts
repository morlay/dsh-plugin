// 通用表单的提示面：注册同步读数，投影时补出 dict 的候选键、字段的候选值与文案。
//
// 读数必须同步（投影发生在渲染帧里）：异步来源由业务取好再注册，注册本身即一次变更通知。

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import { DYNAMIC_SEGMENT } from "./schema-node.ts";

// 一个 dict 字段的候选键读数。
export type SuggestedKeysReader = () => readonly string[];

// 一个字段的文案（业务知道的说法；schema 上没有 title 这种位）。
export interface FieldText {
  // 短名字（行式视图里当注释的抬头）。
  label?: string | undefined;
  // 一句话说明。
  hint?: string | undefined;
}

// 一个字段的文案读数。
export type FieldTextReader = () => FieldText;

// 一个可选项：要写进去的值，以及页面上显示的名字。
export interface SelectOption {
  // 选中时写进配置的值。
  value: unknown;
  // 显示名；省略就用值本身。
  label?: string | undefined;
}

// 一个字段的候选值读数。
export interface SelectSpec {
  // 候选依赖哪些兄弟字段（相对该字段所在对象的路径）：声明只表示"何时重算"，编辑兄弟字段即换候选。
  dependsOn?: readonly (readonly string[])[] | undefined;
  // 按依赖路径读当前值（草稿优先），返回可选项（顺序即页面顺序）。
  options: (read: (path: readonly string[]) => unknown) => readonly SelectOption[];
}

// 一个命名空间里各字段的候选键、文案与候选值。
export interface SchemaFormHintsFace {
  // 注册一个 dict 字段的候选键读数（同处重复注册会覆盖并通知一次）；返回注销函数。
  suggestKeys(ns: string, path: readonly string[], read: SuggestedKeysReader): () => void;
  // 读某处当前声明的候选键；没注册过就是空数组。
  keysFor(ns: string, path: readonly string[]): readonly string[];

  // 注册一个字段的文案（短名 + 一句话说明）：行式视图画成注释行，schema 的 `description` 是兜底；返回注销函数。
  describe(ns: string, path: readonly string[], read: FieldTextReader): () => void;

  // 读某处当前注册的文案；没注册过就是空对象。
  textFor(ns: string, path: readonly string[]): FieldText;

  // 注册一个字段的候选值读数（页面据此画成选择器，随依赖字段变化重算）；返回注销函数。
  select(ns: string, path: readonly string[], spec: SelectSpec): () => void;

  // 注册一个具名候选源：schema 上用 `role('select', { source })` 认领，字段不必按 ns/path 登记，一个源可被多行复用。
  // 返回注销函数。
  source(name: string, spec: SelectSpec): () => void;

  // 读一个具名候选源；没注册过就是 `undefined`。
  sourceFor(name: string): SelectSpec | undefined;

  // 读某处当前声明的候选值读数；没注册过就是 `undefined`。
  selectFor(ns: string, path: readonly string[]): SelectSpec | undefined;
}

// 提示面的完整服务（业务用注册侧，表单一侧用读侧）。
export class SchemaFormHints extends Service implements SchemaFormHintsFace {
  readonly #readers = new Map<string, SuggestedKeysReader>();
  readonly #texts = new Map<string, FieldTextReader>();
  readonly #selects = new Map<string, SelectSpec>();
  readonly #sources = new Map<string, SelectSpec>();
  readonly #listeners = new Set<() => void>();

  constructor(ctx: Context) {
    super(ctx, "schemaFormHints");
  }

  keysFor(ns: string, path: readonly string[]): readonly string[] {
    return lookup(this.#readers, ns, path)?.() ?? [];
  }

  textFor(ns: string, path: readonly string[]): FieldText {
    return lookup(this.#texts, ns, path)?.() ?? {};
  }

  select(ns: string, path: readonly string[], spec: SelectSpec): () => void {
    const key = locationKey(ns, path);
    this.#selects.set(key, spec);
    this.#publish();
    return () => {
      if (this.#selects.get(key) !== spec) return;
      this.#selects.delete(key);
      this.#publish();
    };
  }

  selectFor(ns: string, path: readonly string[]): SelectSpec | undefined {
    return lookup(this.#selects, ns, path);
  }

  source(name: string, spec: SelectSpec): () => void {
    this.#sources.set(name, spec);
    this.#publish();
    return () => {
      if (this.#sources.get(name) !== spec) return;
      this.#sources.delete(name);
      this.#publish();
    };
  }

  sourceFor(name: string): SelectSpec | undefined {
    return this.#sources.get(name);
  }

  describe(ns: string, path: readonly string[], read: FieldTextReader): () => void {
    const key = locationKey(ns, path);
    this.#texts.set(key, read);
    this.#publish();
    return () => {
      if (this.#texts.get(key) !== read) return;
      this.#texts.delete(key);
      this.#publish();
    };
  }

  suggestKeys(ns: string, path: readonly string[], read: SuggestedKeysReader): () => void {
    const key = locationKey(ns, path);
    this.#readers.set(key, read);
    this.#publish();
    return () => {
      if (this.#readers.get(key) !== read) return;
      this.#readers.delete(key);
      this.#publish();
    };
  }

  // 观察候选键的变化（注册与注销）；返回取消订阅。
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  // 重新通知一次：读数背后的数据变了（业务自己知道），页面据此重算候选行。
  refresh(): void {
    this.#publish();
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }
}

// 一处字段的定位键（命名空间 + 路径）。
function locationKey(ns: string, path: readonly string[]): string {
  return `${ns}\u0000${path.join("\u0000")}`;
}

// 按具体路径找一处注册：先精确匹配，再试模板变体（动态键 / 数组下标的段写成 `*`，一条 `models.*.provider` 覆盖整个模式）。
function lookup<T>(map: Map<string, T>, ns: string, path: readonly string[]): T | undefined {
  const exact = map.get(locationKey(ns, path));
  if (exact !== undefined) return exact;
  for (const masked of templates(path)) {
    const hit = map.get(locationKey(ns, masked));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// 具体路径的模板变体（首段是顶层字段名，保持原样）：通配得多的先试。
function* templates(path: readonly string[]): Generator<readonly string[]> {
  const wildcardable = Math.max(0, path.length - 1);
  for (let bits = (1 << wildcardable) - 1; bits > 0; bits--) {
    yield path.map((segment, index) =>
      index > 0 && (bits & (1 << (index - 1))) !== 0 ? DYNAMIC_SEGMENT : segment,
    );
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    // 通用表单的提示面（dict 的候选键）。
    schemaFormHints: SchemaFormHints;
  }
}

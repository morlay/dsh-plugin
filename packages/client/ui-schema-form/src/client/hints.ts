/**
 * 通用表单的提示面：业务知道、而 schema 表达不了的结构信息。
 *
 * 两件事：**dict 字段的候选键**（例如「会话模式」那一行，键是运行期清单里的模式 id，schema 里写不出来），以及
 * **字段的候选值**（选服务商、选模型这类——候选来自部署里的另一份配置，还经常互相依赖）。业务在客户端注册一个
 * 同步读数，表单一侧在投影时用它补出「未配置」行或把字段画成选择器。
 *
 * 读数必须是**同步**的：投影发生在渲染帧里。异步来源（HTTP / remote）由业务自己取好再注册；注册本身就当作一次
 * 变更通知（所以"取到清单后再注册"是推荐用法）。
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";
import { DYNAMIC_SEGMENT } from "./schema-node.ts";

/** 一个 dict 字段的候选键读数。 */
export type SuggestedKeysReader = () => readonly string[];

/** 一个字段的文案（业务知道的说法；schema 上没有 title 这种位）。 */
export interface FieldText {
  /** 短名字（行式视图里当注释的抬头）。 */
  label?: string | undefined;
  /** 一句话说明。 */
  hint?: string | undefined;
}

/** 一个字段的文案读数。 */
export type FieldTextReader = () => FieldText;

/** 一个可选项：要写进去的值，以及页面上显示的名字。 */
export interface SelectOption {
  /** 选中时写进配置的值。 */
  value: unknown;
  /** 显示名；省略就用值本身。 */
  label?: string | undefined;
}

/** 一个字段的候选值读数。 */
export interface SelectSpec {
  /**
   * 候选依赖哪些**兄弟字段**（相对该字段所在对象的路径）。
   *
   * 依赖只声明"什么时候要重算"：读侧在投影时按当前读数（草稿优先）求一次候选，所以声明了依赖的字段会随着
   * 兄弟字段的编辑立刻换候选——「选完服务商才列它有哪些模型」就是这么来的。
   */
  dependsOn?: readonly (readonly string[])[] | undefined;
  /**
   * 求候选。
   * @param read - 按依赖路径（相对该字段所在对象）读当前值：草稿优先。
   * @returns 可选项，顺序即页面上的顺序。
   */
  options: (read: (path: readonly string[]) => unknown) => readonly SelectOption[];
}

/** 一个命名空间里各字段的候选键、文案与候选值。 */
export interface SchemaFormHintsFace {
  /**
   * 注册一个 dict 字段的候选键读数（重复注册同一处会覆盖，并通知一次）。
   * @param ns - settings 命名空间（行 id）。
   * @param path - 该 dict 字段的具体路径（顶层字段就是 `['models']`）。
   * @param read - 同步读数：当前候选键（顺序即页面上的顺序）。
   * @returns 注销函数。
   */
  suggestKeys(ns: string, path: readonly string[], read: SuggestedKeysReader): () => void;
  /**
   * 读某处当前声明的候选键。
   * @param ns - settings 命名空间。
   * @param path - 该字段的路径。
   * @returns 候选键；没注册过就是空数组。
   */
  keysFor(ns: string, path: readonly string[]): readonly string[];

  /**
   * 注册一个字段的文案（短名 + 一句话说明）。行式视图把它画成注释行；schema 的 `description` 是兜底。
   * @param ns - settings 命名空间。
   * @param path - 该字段的路径。
   * @param read - 同步读数。
   * @returns 注销函数。
   */
  describe(ns: string, path: readonly string[], read: FieldTextReader): () => void;

  /**
   * 读某处当前注册的文案。
   * @param ns - settings 命名空间。
   * @param path - 该字段的路径。
   * @returns 文案；没注册过就是空对象。
   */
  textFor(ns: string, path: readonly string[]): FieldText;

  /**
   * 注册一个字段的候选值读数（页面据此把字段画成选择器，并随依赖字段变化重算）。
   * @param ns - settings 命名空间。
   * @param path - 该字段的路径。
   * @param spec - 候选取法与它依赖的兄弟字段。
   * @returns 注销函数。
   */
  select(ns: string, path: readonly string[], spec: SelectSpec): () => void;

  /**
   * 注册一个**具名候选源**：schema 上用 `role('select', { source })` 认领它，字段因此不必在客户端按 ns/path
   * 登记——同一个源可以被多行、多个字段复用（「服务商」「模型」就是这种）。
   * @param name - 源的名字（schema 的 `role` extra 里写的那一个）。
   * @param spec - 候选取法与它依赖的兄弟字段。
   * @returns 注销函数。
   */
  source(name: string, spec: SelectSpec): () => void;

  /**
   * 读一个具名候选源。
   * @param name - 源的名字。
   * @returns 该源的读数；没注册过就是 `undefined`。
   */
  sourceFor(name: string): SelectSpec | undefined;

  /**
   * 读某处当前声明的候选值读数。
   * @param ns - settings 命名空间。
   * @param path - 该字段的路径。
   * @returns 候选读数；没注册过就是 `undefined`。
   */
  selectFor(ns: string, path: readonly string[]): SelectSpec | undefined;
}

/** 提示面的完整服务（业务用注册侧，表单一侧用读侧）。 */
export class SchemaFormHints extends Service implements SchemaFormHintsFace {
  readonly #readers = new Map<string, SuggestedKeysReader>();
  readonly #texts = new Map<string, FieldTextReader>();
  readonly #selects = new Map<string, SelectSpec>();
  readonly #sources = new Map<string, SelectSpec>();
  readonly #listeners = new Set<() => void>();

  /** @param ctx - 提供本服务的插件上下文。 */
  constructor(ctx: Context) {
    super(ctx, "schemaFormHints");
  }

  /** @param ns - settings 命名空间。 @param path - 字段路径。 @returns 该处的键。 */
  keysFor(ns: string, path: readonly string[]): readonly string[] {
    return lookup(this.#readers, ns, path)?.() ?? [];
  }

  /** @param ns - settings 命名空间。 @param path - 字段路径。 @returns 该处注册的文案。 */
  textFor(ns: string, path: readonly string[]): FieldText {
    return lookup(this.#texts, ns, path)?.() ?? {};
  }

  /**
   * @param ns - settings 命名空间。
   * @param path - 字段路径。
   * @param spec - 候选取法与依赖。
   * @returns 注销函数。
   */
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

  /** @param ns - settings 命名空间。 @param path - 字段路径。 @returns 该处注册的候选读数。 */
  selectFor(ns: string, path: readonly string[]): SelectSpec | undefined {
    return lookup(this.#selects, ns, path);
  }

  /**
   * @param name - 源的名字。
   * @param spec - 候选取法与依赖。
   * @returns 注销函数。
   */
  source(name: string, spec: SelectSpec): () => void {
    this.#sources.set(name, spec);
    this.#publish();
    return () => {
      if (this.#sources.get(name) !== spec) return;
      this.#sources.delete(name);
      this.#publish();
    };
  }

  /** @param name - 源的名字。 @returns 该源注册的候选读数。 */
  sourceFor(name: string): SelectSpec | undefined {
    return this.#sources.get(name);
  }

  /**
   * @param ns - settings 命名空间。
   * @param path - 字段路径。
   * @param read - 同步读数。
   * @returns 注销函数。
   */
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

  /**
   * @param ns - settings 命名空间。
   * @param path - 字段路径。
   * @param read - 同步读数。
   * @returns 注销函数。
   */
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

  /**
   * 观察候选键的变化（注册与注销）。
   * @param listener - 变更回调。
   * @returns 取消订阅。
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * 重新通知一次：读数背后的数据变了（业务自己知道），页面据此重算候选行。
   */
  refresh(): void {
    this.#publish();
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** 一处字段的定位键（命名空间 + 路径）。 */
function locationKey(ns: string, path: readonly string[]): string {
  return `${ns}\u0000${path.join("\u0000")}`;
}

/**
 * 按具体路径找一处注册：先精确匹配，再试**模板变体**（动态键 / 数组下标的段写成 `*`）。
 *
 * 业务因此可以注册一次 `models.*.provider` 就覆盖每个模式，不必知道运行期有哪些键。
 * @param map - 某类注册表。
 * @param ns - settings 命名空间。
 * @param path - 具体路径。
 * @returns 命中的注册，或 `undefined`。
 */
function lookup<T>(map: Map<string, T>, ns: string, path: readonly string[]): T | undefined {
  const exact = map.get(locationKey(ns, path));
  if (exact !== undefined) return exact;
  for (const masked of templates(path)) {
    const hit = map.get(locationKey(ns, masked));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 具体路径的模板变体（首段是顶层字段名，保持原样）：通配得多的先试。 */
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
    /** 通用表单的提示面（dict 的候选键）。 */
    schemaFormHints: SchemaFormHints;
  }
}

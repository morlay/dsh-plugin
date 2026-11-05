// 各命名空间的**配置 schema**（序列化后的 schemastery，UI 用 `new Schema(json)` 重建表单）。
//
// 源头是 provider 行自己的上游 `Config`：`llm-deepseek-api-key` / `llm-pi-ai` 两条行在 `onInit` 里
// 注册自己的 `Config.toJSON()`。这里不抄 provider 清单——注册表是空的就说明那条 provider 没装。
//
// 注册时顺带从 schema 里读出**默认值树**：视图的 `value` 是「schema 默认值 ⊕ 用户值」，默认值只有一个
// home（schema 自己），不在这里再手写一份。
import { Injectable } from "@morlay/zephyr";

/** 序列化后的 schemastery 节点（`schema.toJSON()` 的 `refs` 里的一个条目）。 */
interface SchemaNode {
  readonly type?: unknown;
  readonly meta?: { readonly default?: unknown; readonly role?: unknown };
  /** `object` / `dict` 的子节点：键 → `refs` 里的 id。 */
  readonly dict?: Readonly<Record<string, unknown>>;
}

/** 一条注册项：给 UI 的序列化 schema + 它声明的默认值树。 */
interface SchemaEntry {
  readonly json: unknown;
  readonly defaults: Readonly<Record<string, unknown>>;
}

/** 配置 schema 注册表：命名空间 → schemastery 的 JSON。 */
@Injectable()
export class SettingSchema {
  private readonly schemas = new Map<string, SchemaEntry>();

  /**
   * 注册一个命名空间的 schema（同一命名空间后注册的覆盖先前的，与 provider 行的挂载顺序一致）。
   * @param ns - 上游命名空间（与 `listConfigurableProviders()` 的 `settingsNs` 同名）。
   * @param schema - `Config.toJSON()` 的结果。
   */
  register(ns: string, schema: unknown): void {
    this.schemas.set(ns, { json: schema, defaults: defaultsOf(schema) });
  }

  /**
   * 取一个命名空间的 schema。
   * @param ns - 上游命名空间。
   * @returns JSON 形状的 schema；没注册时 `undefined`。
   */
  get(ns: string): unknown {
    return this.schemas.get(ns)?.json;
  }

  /**
   * 取一个命名空间 schema 声明的默认值树（视图 `value` 的默认层）。
   * @param ns - 上游命名空间。
   * @returns 默认值树；没注册时 `{}`。
   */
  defaultsOf(ns: string): Readonly<Record<string, unknown>> {
    return this.schemas.get(ns)?.defaults ?? {};
  }

  /**
   * 已注册 schema 的命名空间（`describe` 枚举的一路来源：有 schema 就有可描述的视图）。
   * @returns 命名空间名。
   */
  names(): readonly string[] {
    return [...this.schemas.keys()];
  }
}

/**
 * 一个 schema 声明的默认值树。
 *
 * 逐字段读 `meta.default`：`dict` 里的子节点是 `refs` 的引用（数字 id），要顺着引用解析；`object` 往下递归
 * （嵌套对象自身的 default 常是空对象，真正的默认值在它的字段上）。**只在 schema 声明了 default 时才带这个键**：
 * `required` 字段没有默认层，缺省就该缺着（与上游 `SettingsNamespaceView.value` 的口径一致）。
 * @param schema - `schema.toJSON()` 的结果。
 * @returns 默认值树；形状不认识时 `{}`。
 */
function defaultsOf(schema: unknown): Record<string, unknown> {
  const envelope = schema as { readonly uid?: unknown; readonly refs?: unknown } | null | undefined;
  if (typeof envelope !== "object" || envelope === null) return {};
  const refs = envelope.refs;
  if (typeof refs !== "object" || refs === null) return {};
  const root = (refs as Record<string, SchemaNode>)[String(envelope.uid)];
  return root === undefined ? {} : fieldDefaults(root, refs as Record<string, SchemaNode>);
}

/**
 * 一个 `object` 节点的字段默认值。
 * @param node - 当前节点。
 * @param refs - 整份 schema 的引用表。
 * @returns 字段 → 默认值。
 */
function fieldDefaults(
  node: SchemaNode,
  refs: Readonly<Record<string, SchemaNode>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.type !== "object" || typeof node.dict !== "object" || node.dict === null) return out;
  for (const [key, id] of Object.entries(node.dict)) {
    const child = refs[String(id)];
    if (child === undefined) continue;
    // 密钥槽的默认值不出（`SettingsNamespaceView` 对 secret 的默认值同样是脱敏掉的）。
    if (child.meta?.role === "secret") continue;
    if (child.type === "object") {
      const nested = fieldDefaults(child, refs);
      if (Object.keys(nested).length > 0 || child.meta?.default !== undefined) out[key] = nested;
      continue;
    }
    if (child.meta?.default !== undefined) out[key] = structuredClone(child.meta.default);
  }
  return out;
}

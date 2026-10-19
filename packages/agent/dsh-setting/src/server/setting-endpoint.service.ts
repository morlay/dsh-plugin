// `settings` 组的宿主实现：把配置文档投影成 UI（`ui-settings-*`）要的形状。
//
// 形状照上游 descriptor（`SettingsDescribeValue` / `SettingsNamespaceView`）：`value` 是**生效值**
// （schema 默认值 → 用户层），`user` 只放用户自己写的那一份。没有 base 分层、没有密钥脱敏——本装配不做这些。
import { RemoteHandlers } from "@morlay/zephyr-app";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Llm } from "@morlay/dsh-agent";
import { asRemoteResult, RemoteGroup, RemoteMethod, registerRemoteGroup, type RemoteResultWire } from "@morlay/zephyr-app/remote";
import { Setting, type SettingDocument } from "../contract/setting.contract.ts";
import { SettingSchema } from "../setting-schema.service.ts";
import { mergeTree } from "../setting.service.ts";

/** 一条路径操作（UI 的 `mutate` 载荷）。 */
type PathOp =
  | { readonly op: "set"; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: "unset"; readonly path: readonly string[] };

/** 一个命名空间的视图（UI 按它渲染表单）。 */
interface NamespaceView {
  readonly autoGenerate: boolean;
  readonly ns: string;
  /** 序列化后的 schemastery（UI `new Schema(json)` 重建表单）；**不能是 `null`**。 */
  readonly schema: unknown;
  readonly value: unknown;
  /** 用户自己写的那一份（`settings.json` 里的原值）；没有就是缺省。 */
  readonly user?: unknown;
  readonly applies: "live";
  readonly secrets: readonly unknown[];
  readonly revision: number;
}

/** `settings` 组的宿主实现。 */
@RemoteGroup({ name: "settings" })
@Injectable()
export class SettingEndpointDefault implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly setting = inject(Setting);

  /** 已注册的 configurable provider 目录：`settings/describe` 的枚举源头（与 `llm/listConfigurableProviders` 同一份数据）。 */
  private readonly llm = inject(Llm);

  /** 各命名空间的配置 schema（provider 行注册；没注册的给最小 object schema）。 */
  private readonly schemas = inject(SettingSchema);

  /** revision 只用于让 UI 判断「这份视图旧不旧」；本装配没有并发写，按写入次数递增即可。 */
  private readonly revisions = new Map<string, number>();

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  /**
   * 描述所有命名空间。
   *
   * 枚举的源头有两条：**已注册的 configurable provider 目录**（`llm.listConfigurableProviders()`）与
   * **已注册 schema 的命名空间**（`ui-theme` 这类不是 provider、但有 durable schema 的命名空间）。
   * 不是 `settings.json` 里已有的键：设置页按命名空间查视图（
   * `ui-settings-models/src/client/store.ts:250`），文件为空时也必须给出每一条（`value` 只有默认层）。
   * 与文件里多出来的键取并集，用户手写过的配置不会因为目录里没有 provider 而消失。
   */
  @RemoteMethod()
  describe(): Promise<RemoteResultWire<{ writable: boolean; hasDocument: boolean; namespaces: NamespaceView[] }>> {
    // **必须包成 wire 的 `RemoteResult`**：客户端（`ui-settings` 的 `SettingsDescribeMirror.run`）
    // 读 `response.ok` / `response.error.message`，返回裸对象会让 `response.ok` 是 `undefined`，
    // 于是 `response.error.message` 抛 `Cannot read properties of undefined (reading 'message')`。
    return asRemoteResult(async () => {
      const document = this.setting.snapshot();
      // 命名空间既可能以嵌套对象出现（`{"ui-theme": {"preference": "dark"}}`），也可能以**点号扁平键**
      // 出现（`{"ui-theme.preference": "dark"}`，上游 `SettingsForms` 的写法）。两种都归到同一个 ns。
      const names = new Set<string>([
        ...this.llm.listConfigurableProviders().map((provider) => provider.settingsNs),
        ...this.schemas.names(),
        ...Object.keys(document).map((key) => key.split(".")[0] ?? key),
      ]);
      const namespaces = [...names].map((ns) => this.viewOf(ns, namespaceOf(document, ns)));
      return { writable: true, hasDocument: true, namespaces };
    });
  }

  /**
   * 按路径改写一个命名空间。
   *
   * **单参数对象**：wire 上 `registerRemoteGroup` 只把整个 args 交给方法（命名参数已经在外面被
   * 折成一个对象），多参数签名在这里收不到 `ops`。
   * @param input - 命名空间键与 `set` / `unset` 序列。
   * @returns 改写后的视图。
   */
  @RemoteMethod()
  mutate(input: { readonly ns: string; readonly ops: readonly PathOp[] }): Promise<RemoteResultWire<NamespaceView>> {
    return asRemoteResult(async () => {
      const { ns, ops } = input;
      const document = this.setting.snapshot();
      const current = document[ns];
      const value: SettingDocument =
        typeof current === "object" && current !== null ? structuredClone(current as SettingDocument) : {};
      for (const op of ops) {
        if (op.op === "set") setPath(value, op.path, op.value);
        else unsetPath(value, op.path);
      }
      this.setting.replace(ns, value);
      this.revisions.set(ns, (this.revisions.get(ns) ?? 0) + 1);
      return this.viewOf(ns, value);
    });
  }

  /** 打开本地文档：只回 `{ opened: true }`，不暴露宿主路径。 */
  @RemoteMethod()
  openSettingsDocument(): Promise<RemoteResultWire<{ opened: true }>> {
    return asRemoteResult(async () => ({ opened: true }));
  }

  /**
   * 深合并一个命名空间（上游 `settings/update` 语义：`patch` 逐键递归，其余类型后写覆盖）。
   * @param input - 命名空间、要合并进去的键树、期望 revision（`undefined` 表示不校验）。
   * @returns 写后的视图。
   */
  @RemoteMethod()
  update(
    input: { readonly ns: string; readonly patch: Record<string, unknown>; readonly expectedRevision?: number },
  ): Promise<RemoteResultWire<NamespaceView>> {
    return asRemoteResult(async () => {
      const written = this.setting.update(input.ns, input.patch, input.expectedRevision);
      this.revisions.set(input.ns, written.revision);
      return this.viewOf(input.ns, written.user);
    });
  }

  /**
   * 整段覆盖一个命名空间（上游 `settings/replace` 语义：`section` 就是新值，不与旧值合并）。
   * @param input - 命名空间、新值、期望 revision（`undefined` 表示不校验）。
   * @returns 写后的视图。
   */
  @RemoteMethod()
  replace(
    input: { readonly ns: string; readonly section: Record<string, unknown>; readonly expectedRevision?: number },
  ): Promise<RemoteResultWire<NamespaceView>> {
    return asRemoteResult(async () => {
      const written = this.setting.replace(input.ns, input.section, input.expectedRevision);
      this.revisions.set(input.ns, written.revision);
      return this.viewOf(input.ns, written.user);
    });
  }

  /**
   * 一个命名空间的视图：`value` 是生效值，`user` 只有用户写过的层。
   *
   * `value` **必须**合并 schema 默认值：客户端 `ui-theme` 的 `ThemeRuntime.adopt` 直接把它当完整配置读
   * （`normalizeFontFamily(value.textFontFamily.split(','))`），缺字段就是浏览器里的
   * `Cannot read properties of undefined (reading 'split')`——写通了、读塌了、刷新回到默认值。
   * @param ns - 命名空间。
   * @param user - 用户层（文档里的原值；没写过就是 `undefined`）。
   * @returns UI 读的视图。
   */
  private viewOf(ns: string, user?: unknown): NamespaceView {
    const userLayer =
      typeof user === "object" && user !== null && !Array.isArray(user) ? (user as SettingDocument) : undefined;
    return {
      autoGenerate: false,
      ns,
      schema: this.schemas.get(ns) ?? { type: "object", dict: {} },
      value: effectiveValueOf(this.schemas.defaultsOf(ns), userLayer),
      ...(userLayer === undefined ? {} : { user: userLayer }),
      applies: "live",
      secrets: [],
      revision: this.revisions.get(ns) ?? 0,
    };
  }
}

/**
 * 一个命名空间的**生效值**：schema 默认 → base → user 三层合并。
 *
 * 当前装配没有 base 层，所以它是「schema 默认值 ⊕ 用户值」；这里**独立推导**（不是把 `user` 直接当
 * `value` 传下去），`user` 仍然只表示「用户显式改过的层」——
 * `ui-settings-models` 的 `removable`、`config-form` 的 `draft.user` 都按这个语义判断。
 * @param defaults - schema 声明的默认值树。
 * @param user - 用户层（可能是 `undefined`）。
 * @returns 合并后的生效值。
 */
function effectiveValueOf(
  defaults: Readonly<Record<string, unknown>>,
  user: SettingDocument | undefined,
): SettingDocument {
  const base = structuredClone(defaults) as SettingDocument;
  return user === undefined ? base : mergeTree(base, user);
}

/**
 * 取一个命名空间的用户层：嵌套对象 + 点号扁平键合并后的结果。
 * @param document - 整份配置文档。
 * @param ns - 命名空间（`ui-theme` / `llm-deepseek-api-key` …）。
 * @returns 该命名空间的用户层；完全没有时 `undefined`。
 */
function namespaceOf(document: SettingDocument, ns: string): SettingDocument | undefined {
  const nested = document[ns];
  const flat = Object.entries(document).filter(([key]) => key.startsWith(`${ns}.`));
  if (flat.length === 0) {
    return typeof nested === "object" && nested !== null && !Array.isArray(nested)
      ? (nested as SettingDocument)
      : undefined;
  }
  const value: SettingDocument =
    typeof nested === "object" && nested !== null && !Array.isArray(nested)
      ? structuredClone(nested as SettingDocument)
      : {};
  for (const [key, entry] of flat) setPath(value, key.slice(ns.length + 1).split("."), entry);
  return value;
}

/** 按路径写值（`['a','b']` → `doc.a.b`），中途缺对象就建。 */
function setPath(target: SettingDocument, path: readonly string[], value: unknown): void {
  if (path.length === 0) return;
  let cursor: SettingDocument = target;
  for (const key of path.slice(0, -1)) {
    const next = cursor[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) cursor[key] = {};
    cursor = cursor[key] as SettingDocument;
  }
  cursor[path[path.length - 1] as string] = value;
}

/** 按路径删值；路径不通就什么都不做。 */
function unsetPath(target: SettingDocument, path: readonly string[]): void {
  if (path.length === 0) return;
  let cursor: SettingDocument = target;
  for (const key of path.slice(0, -1)) {
    const next = cursor[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return;
    cursor = next as SettingDocument;
  }
  delete cursor[path[path.length - 1] as string];
}

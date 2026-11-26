// `settings` 组的宿主实现：把配置文档投影成 UI（`ui-settings-*`）要的形状。
//
// 形状照上游 descriptor（`SettingsDescribeValue` / `SettingsNamespaceView`）：`value` 是**生效值**
// （schema 默认值 → **行 config（base）** → 用户层），`base` 是装配层 `configure(实现类, …)` 给的那一份，
// `user` 只放用户自己写的那一份。
//
// 三层都按 schema 的 `role('secret')` 脱敏，`secrets` 如实给出每个密钥位「有没有值」：密钥只写不读，
// UI 靠它渲染「已设置 / 未设置」，读回的永远是抹掉之后的树。
import { RemoteHandlers } from "@morlay/zephyr-app";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import {
  registerRemoteGroup,
} from "@morlay/zephyr-app/remote";
import { Setting, type SettingDocument } from "@morlay/zephyr-app";
import { SettingSchema, type ConfigSchema } from "@morlay/zephyr-app";
import { redactSecrets, type RedactedSecret } from "@deepseek-ai/dsh-settings";
import type { SettingsNamespaceView, SettingsPathOpView } from "@deepseek-ai/dsh-settings/types";
import { mergeTree } from "../setting.service.ts";
import { SettingsEndpoint } from "../endpoint/index.ts";

// 视图与路径操作**就是上游那两个类型**（`@deepseek-ai/dsh-settings/types`）：手写一份只会多一处会漂的声明，
// 而且上游 `ui-settings` 的 `config-form` 用 `'base' in view` 判「是不是装配层给的」——两处声明迟早漂在那里。
type PathOp = SettingsPathOpView;
type NamespaceView = SettingsNamespaceView;
// 可序列化值：从上游视图字段派生，不为一处引新依赖。
type JsonValue = SettingsNamespaceView["schema"];

/** `settings` 组的宿主实现（继承契约：方法名 / wire 名 / 形参只有契约一处声明）。 */
@Injectable()
export class SettingEndpointDefault extends SettingsEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly setting = inject(Setting);

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
  override async describe(): Promise<{
    writable: boolean;
    hasDocument: boolean;
    namespaces: NamespaceView[];
  }> {
    // 回**裸值**：上游客户端读的 `response.ok` 那一层是**桥与客户端面**包的（`faceOf` / `RemoteHandlersRpcBridge`）。
    // 宿主再包一层就是双包——客户端会读到 `{ ok, value: { ok, value } }`，`response.error.message` 直接炸。
    {
      const document = this.setting.snapshot();
      // 命名空间既可能以嵌套对象出现（`{"ui-theme": {"preference": "dark"}}`），也可能以**点号扁平键**
      // 出现（`{"ui-theme.preference": "dark"}`，上游 `SettingsForms` 的写法）。两种都归到同一个 ns。
      const names = new Set<string>([
        ...this.schemas.names(),
        ...Object.keys(document).map((key) => key.split(".")[0] ?? key),
      ]);
      const namespaces = [...names].map((ns) => this.viewOf(ns, namespaceOf(document, ns)));
      return { writable: true, hasDocument: true, namespaces };
    }
  }

  /**
   * 按路径改写一个命名空间。
   *
   * **单参数对象**：wire 上 `registerRemoteGroup` 只把整个 args 交给方法（命名参数已经在外面被
   * 折成一个对象），多参数签名在这里收不到 `ops`。
   * @param input - 命名空间键与 `set` / `unset` 序列。
   * @returns 改写后的视图。
   */
  override async mutate(ns: string, ops: readonly PathOp[]): Promise<NamespaceView> {
    {
      const document = this.setting.snapshot();
      const current = document[ns];
      const value: SettingDocument =
        typeof current === "object" && current !== null
          ? structuredClone(current as SettingDocument)
          : {};
      for (const op of ops) {
        if (op.op === "set") setPath(value, op.path, op.value);
        else unsetPath(value, op.path);
      }
      this.setting.replace(ns, value);
      this.revisions.set(ns, (this.revisions.get(ns) ?? 0) + 1);
      return this.viewOf(ns, value);
    }
  }

  /** 打开本地文档：只回 `{ opened: true }`，不暴露宿主路径。 */
  override async openSettingsDocument(): Promise<{ opened: true }> {
    return { opened: true };
  }

  /**
   * 深合并一个命名空间（上游 `settings/update` 语义：`patch` 逐键递归，其余类型后写覆盖）。
   * @param input - 命名空间、要合并进去的键树、期望 revision（`undefined` 表示不校验）。
   * @returns 写后的视图。
   */
  override async update(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<NamespaceView> {
    const written = this.setting.update(ns, patch, expectedRevision);
    this.revisions.set(ns, written.revision);
    return this.viewOf(ns, written.user);
  }

  /**
   * 整段覆盖一个命名空间（上游 `settings/replace` 语义：`section` 就是新值，不与旧值合并）。
   * @param input - 命名空间、新值、期望 revision（`undefined` 表示不校验）。
   * @returns 写后的视图。
   */
  override async replace(
    ns: string,
    section: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<NamespaceView> {
    const written = this.setting.replace(ns, section, expectedRevision);
    this.revisions.set(ns, written.revision);
    return this.viewOf(ns, written.user);
  }

  /**
   * 一个命名空间的视图：`value` 是生效值，`base` 只有装配层，`user` 只有用户写过的层。
   *
   * `value` **必须**合并 schema 默认值：客户端 `ui-theme` 的 `ThemeRuntime.adopt` 直接把它当完整配置读
   * （`normalizeFontFamily(value.textFontFamily.split(','))`），缺字段就是浏览器里的
   * `Cannot read properties of undefined (reading 'split')`——写通了、读塌了、刷新回到默认值。
   *
   * `value` 还要合并**装配层**（行 config）：模型页按 `value` 的 `settingsPath` 判「这个 provider 配没配」，
   * 少了 base，装配里 `configure` 配好的 provider 在页面上永远是「未配置」、只能从「添加」里重配一份。
   * @param ns - 命名空间。
   * @param user - 用户层（文档里的原值；没写过就是 `undefined`）。
   * @returns UI 读的视图。
   */
  private viewOf(ns: string, user?: unknown): NamespaceView {
    const userLayer =
      typeof user === "object" && user !== null && !Array.isArray(user)
        ? (user as SettingDocument)
        : undefined;
    const schema = this.schemas.liveOf(ns);
    const base = this.schemas.baseOf(ns);
    // 计算时按「空层」（`base ?? {}`）；视图层按「有没有装配层」分派（见下）。两个语义分开处理。
    const value = effectiveValueOf(this.schemas.defaultsOf(ns), base ?? {}, userLayer);
    const redacted = redactOf(schema, value);
    return {
      autoGenerate: false,
      ns,
      schema: (this.schemas.get(ns) ?? { type: "object", dict: {} }) as JsonValue,
      value: redacted.value,
      ...(base === undefined ? {} : { base: redactOf(schema, base).value }),
      ...(userLayer === undefined ? {} : { user: redactOf(schema, userLayer).value }),
      applies: "live",
      // 上游字段是可变数组：拷一份（我们内部按 readonly 传，别把可变引用漏出去）。
      secrets: [...redacted.secrets],
      revision: this.revisions.get(ns) ?? 0,
    };
  }
}

/**
 * 按 schema 的 `role('secret')` 抹掉一个值里的密钥字段。
 *
 * 上游 `redactSecrets` 的入参是**活的 schemastery 节点**；注册表存的正是它，只是这里的类型面只声明了
 * `toJSON()`（设置域不把 schemastery 的类型拉进来）。没有注册活 schema 的命名空间（理论上不会出现）原样返回。
 * @param schema - 该命名空间的活 schema。
 * @param value - 要抹的值。
 * @returns 抹掉密钥的值与密钥位清单。
 */
function redactOf(
  schema: ConfigSchema | undefined,
  value: unknown,
): { value: JsonValue; secrets: readonly RedactedSecret[] } {
  // 视图字段要求可序列化值（`JsonValue`）；抹密钥不改变可序列化性，所以在边界收口一次。
  if (schema === undefined) return { value: value as JsonValue, secrets: [] };
  return redactSecrets(schema as never, value) as { value: JsonValue; secrets: readonly RedactedSecret[] };
}

/**
 * 一个命名空间的**生效值**：schema 默认 → base（装配层）→ user 三层合并。
 *
 * 这里**独立推导**（不是把 `user` 直接当 `value` 传下去），`user` 仍然只表示「用户显式改过的层」——
 * `ui-settings-models` 的 `removable`、`config-form` 的 `draft.user` 都按这个语义判断。
 * @param defaults - schema 声明的默认值树。
 * @param rowConfig - 装配层（行 config）。
 * @param user - 用户层（可能是 `undefined`）。
 * @returns 合并后的生效值。
 */
function effectiveValueOf(
  defaults: Readonly<Record<string, unknown>>,
  rowConfig: Readonly<Record<string, unknown>>,
  user: SettingDocument | undefined,
): SettingDocument {
  const layers = mergeTree(
    structuredClone(defaults) as SettingDocument,
    structuredClone(rowConfig) as SettingDocument,
  );
  return user === undefined ? layers : mergeTree(layers, user);
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

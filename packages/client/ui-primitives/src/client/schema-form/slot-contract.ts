/**
 * 槽契约：字段级自定义输入与文案的注入点，以及承载它的 Factory 契约。
 *
 * 字段槽是 **chain**：注册项在 `select` 里按 `node.meta.role` 或 `ns + path` 决定认领哪个字段，命中即渲染自己的
 * 组件（收到 `matched`），未命中落到本包的默认控件。链式槽的注册项还可以只声明 `label`/`hint`（不改控件）——
 * 默认控件仍会渲染，文案以它为准。
 *
 * 字段槽声明在 Factory 上（`children`），而不是每个行注册项上：slots 的 children 声明 per key 只能一次，而本包
 * 会给每个可渲染的行各注册一个 `plugins.row.config` 项——那些项经 `renderFactorySlot` 渲染同一个 Factory，
 * 于是字段槽只需声明一次，所有行共用。
 */

import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  FactoryComponentPropsOf,
  PropsRuntime,
  TranslateNS,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { SchemaFormActions, SchemaFormFace, SchemaFormState } from "./controller.ts";
import type { TextParse } from "./draft.ts";
import type { SelectOption } from "./hints.ts";
import type { ResolveText } from "./labels.ts";
import type { SchemaFormLocaleKey } from "./locales.ts";
import type { FieldNode } from "./schema-node.ts";

/** `plugins.row.config` 的 key：`<bundle 包名>#<行 id>`（与页面 `rowConfigKey` 同拼法）。 */
export type RowConfigKey = string;

/** 字段槽的 owner props：路由输入 + 显示状态 + 受控动作（默认控件要的一切都在这里）。 */
export interface SchemaFieldOwnerProps {
  /** settings 命名空间（行 id）。 */
  ns: string;
  /** 字段的具体路径（动态段已按真实键或索引替换）。 */
  path: readonly string[];
  /** 字段节点（类型、`role`、`extra`、界限、只读原因）。 */
  node: FieldNode;
  /** 显示标签：默认是字段名拆词，业务方经槽给时会覆盖。 */
  label: string;
  /** 显示说明（`description` 本地化 + `comment`）。 */
  hint: string | undefined;
  /** 当前生效值（草稿优先）。 */
  value: unknown;
  /**
   * 这个字段的可选项：给了就是选择器（点值不再进文本编辑）。来源是字面量集合的 union，或业务经提示面注册的
   * 候选——候选依赖的兄弟字段一变，这里就换一批。
   */
  options: readonly SelectOption[] | undefined;
  /** 文本草稿：文本控件显示它，而不是重新格式化生效值。 */
  text: string | undefined;
  /** secret 槽是否已配置（值本身不回传）。 */
  secretConfigured: boolean;
  /** 嵌套深度：默认控件按它缩进。 */
  depth: number;
  /** 保存后这一字段是否会留下用户层条目。 */
  overridden: boolean;
  /** 草稿不合法时的消息。 */
  invalid: string | undefined;
  /** 只读部署或不可用命名空间时为 true。 */
  disabled: boolean;
  /** 本包字典（复刻或包装默认控件时用）。 */
  t: SchemaFormTranslate;
  /** 容器动作（增删数组项、字典键、丢弃、保存）。 */
  actions: SchemaFormActions;
  /**
   * 分组节点的折叠交互（object / dict / array / tuple）；叶子节点是 `undefined`。
   * 默认折叠与否由 schema 的 `collapse()` 决定，用户点一下就是反转。
   */
  group: { collapsed: boolean; toggle: () => void } | undefined;
  /**
   * 这一行是动态容器的成员本身（dict 的键 / array 的项）时的身份：容器路径、键、数组项的位置。容器成员把它画进
   * 标题行（名字 + 移除），叶子成员由渲染层另起一行——所以「哪个字段属于哪个键/哪一项」在页面上一眼可见。
   */
  member:
    | { parent: readonly string[]; key: string; index: number | undefined; pending?: boolean }
    | undefined;
  /** 暂存一个合法值。 */
  onChange: (value: unknown) => void;
  /**
   * 暂存一段文本：按字段类型的默认规则解析；给了 `parse` 就用它（例如 secret 留空＝不写）。
   * @param text - 用户输入。
   * @param parse - 覆盖默认解析规则。
   */
  onEditText: (text: string, parse?: TextParse) => void;
  /** 暂存「恢复默认」。 */
  onReset: () => void;
}

/**
 * 字段槽注册项的完整 props：框架注入的 owner props（{@link SchemaFieldOwnerProps}）＋它的 `select` 结果。
 *
 * 注册方的组件按这个类型声明参数（**不要**自己重写 owner props 的类型：注册时框架会把它读成 inject 面）。
 */
export type SchemaFieldComponentProps<M extends SchemaFieldMatch = SchemaFieldMatch> =
  PropsRuntime<"settings.schema-form.field"> & { matched: M };

/**
 * 字段槽注册项的 `select`：返回认领结果，或 `null` 表示不认领（chain 槽的约定是 `null` 放行给下一项，
 * `undefined` 不会被当成"不认领"）。
 */
export type SchemaFieldSelect = (field: SchemaFieldOwnerProps) => SchemaFieldMatch | null;

/** 字段槽 `select` 可以只给文案：控件仍由注册方渲染（拿本包的默认控件包一层即可）。 */
export interface SchemaFieldMatch {
  /** 覆盖显示标签。 */
  label?: string;
  /** 覆盖显示说明。 */
  hint?: string;
}

/** Factory 的输入 props：一行的配置页。 */
export interface SchemaFormProps {
  /** settings 命名空间（行 id）。 */
  ns: string;
  /** 该行的控制器动作与状态。 */
  face: SchemaFormFace;
  /** schema 里的本地化文本（`description`）按当前语言解析。 */
  resolveText: ResolveText;
}

/** Factory 组件收到的完整 props。 */
export type SchemaFormComponentProps = FactoryComponentPropsOf<"settings.schema-form.form">;

/** 本包字典的翻译函数（默认控件与表单壳使用）。 */
export type SchemaFormTranslate = TranslateNS<"settings.schema-form">;

/** 渲染层读一行状态的便捷别名。 */
export type { SchemaFormState };

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 表单壳、字段控件与只读呈现的文案。 */
    "settings.schema-form": SchemaFormLocaleKey;
  }

  interface SlotMap {
    /**
     * 字段级自定义输入与文案：按 `role` 或 `ns + path` 认领一个字段，命中即渲染注册方的组件（未命中落到默认
     * 控件）。注册项由业务插件用 `ctx.slots.inject('settings.schema-form.field', …)` 注册，声明由本包的
     * Factory 给出。
     */
    "settings.schema-form.field": { kind: "chain"; scope: "root"; owner: SchemaFieldOwnerProps };
  }

  interface SlotFactoryMap {
    /**
     * 一行配置页的渲染体：每个可渲染的行注册项经 `renderFactorySlot` 渲染同一个 Factory，字段槽因此只需声明
     * 一次（slots 的 children 声明 per key 唯一）。
     */
    "settings.schema-form.form": {
      scope: "root";
      props: SchemaFormProps;
      locale: "settings.schema-form";
      children: { "settings.schema-form.field": { kind: "chain"; scope: "root" } };
    };
  }
}

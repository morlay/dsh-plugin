/**
 * 行式编辑器：按 `editorLines` 排出的行画 JSON 结构视图——行号、折进、`key: value`、结构行、注释行、容器闭合行
 * 后面的添加入口；值在行内点开编辑（Enter 提交 / Esc 撤销）。
 *
 * 缩进只作用在**行内容**上（行号列固定），添加输入与闭合括号同一行；行内控件用官方的 `Input` / `Menu` / `Button`，
 * 与设置页其余部分同一套视觉与键盘行为。
 *
 * 字段槽仍然生效：命中时该字段**值**的位置换成注册方的组件，键名、注释、行号与行为按钮仍由这里画。
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  IconCheckOutlineRegular,
  IconCloseOutlineRegular,
  Input,
  Menu,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { SchemaFormFace, SchemaFormState } from "./controller.ts";
import { fieldKey } from "./controller.ts";
import {
  containerShape,
  editorLines,
  type EditorLine,
  type FoldState,
  type VariantControl,
} from "./lines.ts";
import type { ResolveText } from "./labels.ts";
import { isMultiline, valueText } from "./value.tsx";
import type { SchemaFieldOwnerProps, SchemaFormTranslate } from "./slot-contract.ts";
import {
  AddWrap,
  CompactInput,
  CompactTextField,
  EditorRoot,
  HoverActions,
  LineBody,
  LineComment,
  LineFold,
  LineFoldSpacer,
  LineInvalid,
  LineKey,
  LineNumber,
  LineRow,
  LineToken,
  LineValue,
  ValueTrigger,
} from "./styles.ts";

/** 编辑器要的一切。 */
export interface EditorProps {
  /** settings 命名空间（行 id）。 */
  ns: string;
  /** 页面读数。 */
  state: SchemaFormState;
  /** 动作面（写草稿、保存、丢弃）。 */
  face: SchemaFormFace;
  /** 本包字典。 */
  t: SchemaFormTranslate;
  /** `description` 的本地化。 */
  resolveText: ResolveText;
  /**
   * 一个字段的值位置怎么画（字段槽入口：命中用注册方的组件，否则用本包的行内值）。
   * @param owner - 字段上下文与动作。
   * @returns 行内值的节点。
   */
  renderField: (owner: SchemaFieldOwnerProps) => ReactNode;
}

/**
 * 画一行的配置。
 * @param props - 读数、动作、字典与字段槽入口。
 * @returns 行式编辑器。
 */
export function Editor(props: EditorProps): ReactNode {
  const { ns, state, face, t, resolveText, renderField } = props;
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  // 还没值的格子默认就是输入框；点过「取消」的那些先收起来，点值可以再进来。
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const fold = useFold(state, toggled, setToggled);
  const lines = useMemo(
    () => editorLines(state, fold, resolveText, t),
    [state, fold, resolveText, t],
  );
  const disabled = !state.writable || !state.available;
  return (
    <EditorRoot data-editor="schema-form">
      {lines.map((line, index) => (
        <Row
          key={`${line.kind}:${fieldKey(line.path)}:${String(index)}`}
          line={line}
          n={index + 1}
          ns={ns}
          state={state}
          face={face}
          fold={fold}
          t={t}
          resolveText={resolveText}
          disabled={disabled}
          editing={editing}
          selected={selected}
          onEdit={(key) => {
            setEditing(key);
            if (key !== undefined) {
              setDismissed((previous) => {
                const next = new Set(previous);
                next.delete(key);
                return next;
              });
            }
          }}
          // 刚加进来的那一行直接进编辑态：用户从候选里选完就能打字，不用再点一次那个空值。
          onAdded={(path) => {
            setEditing(fieldKey(path));
          }}
          dismissed={dismissed}
          onDismiss={(key) => {
            setDismissed((previous) => new Set(previous).add(key));
          }}
          onSelect={(path) => {
            setSelected(fieldKey(path));
          }}
          renderField={renderField}
        />
      ))}
    </EditorRoot>
  );
}

/** 折叠状态：记「用户切换过的路径」，开合 = 切换过就反转 schema 的默认值。 */
function useFold(
  state: SchemaFormState,
  toggled: ReadonlySet<string>,
  setToggled: (next: ReadonlySet<string>) => void,
): FoldState {
  const defaults = useMemo(() => {
    const collapsed = new Set<string>();
    for (const item of state.walked) {
      const value = state.fields.get(fieldKey(item.path))?.value;
      if (item.node.meta.collapse && containerShape(item.node, value) !== undefined) {
        collapsed.add(fieldKey(item.path));
      }
    }
    return collapsed;
  }, [state.walked, state.fields]);
  return useMemo(
    () => ({
      collapsed: (path) => {
        const key = fieldKey(path);
        return toggled.has(key) !== defaults.has(key);
      },
      toggle: (path) => {
        const key = fieldKey(path);
        const next = new Set(toggled);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setToggled(next);
      },
    }),
    [defaults, setToggled, toggled],
  );
}

/** 一行的渲染分派。 */
function Row({
  line,
  n,
  ns,
  state,
  face,
  fold,
  t,
  resolveText,
  disabled,
  editing,
  selected,
  dismissed,
  onEdit,
  onAdded,
  onDismiss,
  onSelect,
  renderField,
}: {
  line: EditorLine;
  n: number;
  ns: string;
  state: SchemaFormState;
  face: SchemaFormFace;
  fold: FoldState;
  t: SchemaFormTranslate;
  resolveText: ResolveText;
  disabled: boolean;
  editing: string | undefined;
  selected: string | undefined;
  dismissed: ReadonlySet<string>;
  onEdit: (key: string | undefined) => void;
  onAdded: (path: readonly string[]) => void;
  onDismiss: (key: string) => void;
  onSelect: (path: readonly string[]) => void;
  renderField: (owner: SchemaFieldOwnerProps) => ReactNode;
}): ReactNode {
  const key = fieldKey(line.path);
  const indent = { paddingLeft: `${String(line.depth * 14)}px` };
  const body =
    line.kind === "comment" ? (
      <>
        <LineFoldSpacer data-role="fold" />
        <LineComment>{`// ${line.text}`}</LineComment>
      </>
    ) : line.kind === "open" ? (
      <>
        <LineFold
          data-role="fold"
          type="button"
          aria-expanded={!line.collapsed}
          aria-label={t("toggleGroup")}
          onClick={() => {
            fold.toggle(line.path);
          }}
        >
          {line.collapsed ? "▸" : "▾"}
        </LineFold>
        <LinePrefix line={line} />
        <LineToken>
          {line.shape === "object" ? (line.collapsed ? "{…}" : "{") : line.collapsed ? "[…]" : "["}
        </LineToken>
        <VariantSelect
          control={line.variants}
          path={line.path}
          face={face}
          disabled={disabled}
          t={t}
        />
      </>
    ) : line.kind === "close" ? (
      <>
        <LineFoldSpacer data-role="fold" />
        <LineToken>{line.shape === "object" ? "}" : "]"}</LineToken>
        <AddLine
          line={line}
          state={state}
          face={face}
          t={t}
          resolveText={resolveText}
          disabled={disabled}
          onAdded={onAdded}
        />
      </>
    ) : (
      <FieldLine
        line={line}
        ns={ns}
        state={state}
        face={face}
        t={t}
        disabled={disabled}
        editing={editing}
        dismissed={dismissed}
        onEdit={onEdit}
        onDismiss={onDismiss}
        renderField={renderField}
      />
    );
  return (
    <LineRow
      data-line={line.kind}
      data-field-path={line.path.join(".")}
      data-selected={selected === key ? "true" : undefined}
      data-dirty={line.kind === "field" && line.field.staged ? "true" : undefined}
      data-overridden={
        line.kind === "field" && line.field.overridden && !line.field.staged ? "true" : undefined
      }
      data-invalid={line.kind === "field" && line.field.invalid !== undefined ? "true" : undefined}
    >
      <LineNumber
        data-role="number"
        onClick={() => {
          onSelect(line.path);
        }}
      >
        {n}
      </LineNumber>
      <LineBody data-role="body" style={indent}>
        {body}
      </LineBody>
    </LineRow>
  );
}

/** 字段行：`key: value`（数组成员的键名是下标，淡一些）。 */
function FieldLine({
  line,
  ns,
  state,
  face,
  t,
  disabled,
  editing,
  dismissed,
  onEdit,
  onDismiss,
  renderField,
}: {
  line: Extract<EditorLine, { kind: "field" }>;
  ns: string;
  state: SchemaFormState;
  face: SchemaFormFace;
  t: SchemaFormTranslate;
  disabled: boolean;
  editing: string | undefined;
  dismissed: ReadonlySet<string>;
  onEdit: (key: string | undefined) => void;
  onDismiss: (key: string) => void;
  renderField: (owner: SchemaFieldOwnerProps) => ReactNode;
}): ReactNode {
  const key = fieldKey(line.path);
  const member = line.member;
  const owner: SchemaFieldOwnerProps = {
    ns,
    path: line.path,
    node: line.node,
    label: line.node.label ?? member?.key ?? line.node.key,
    hint: undefined,
    value: line.field.value,
    options: state.options.get(key),
    text: line.field.text,
    secretConfigured: state.secrets.get(key) === true,
    depth: line.depth,
    overridden: line.field.overridden,
    invalid: line.field.invalid,
    disabled,
    t,
    actions: face,
    group: undefined,
    member,
    onChange: (value) => {
      face.set(line.path, value);
    },
    onEditText: (text, parse) => {
      face.setText(line.path, text, parse ?? ((input) => ({ kind: "value", value: input })));
    },
    onReset: () => {
      face.clear(line.path);
    },
  };
  // 不可编辑的几种来源：部署只读（`disabled`）、schema 的只读原因（transform / function / 构造器）、
  // 固定值（`const`，改不了；判别式 union 的标签行靠变体切换改），以及给成选择器的字段——它在值上直接选。
  const readOnly = line.node.meta.disabled || line.node.readOnly !== null;
  const editable =
    !disabled &&
    !readOnly &&
    line.node.type !== "const" &&
    owner.options === undefined &&
    !line.variantsStandIn;
  // 还没有值的位子（`null` / `undefined`）直接就是输入框：用户不用先点一下那个空值；点过取消的先收起来。
  const missing = line.field.value === null || line.field.value === undefined;
  const isEditing = editable && (editing === key || (missing && !dismissed.has(key)));
  const text = line.field.text ?? valueText(line.field.value);
  const multiline = isMultiline(line.field.value) || /[\r\n]/.test(text);
  return (
    <>
      <LineFoldSpacer data-role="fold" />
      <LineKey data-index={member?.index === undefined ? undefined : "true"}>
        {member?.key ?? line.node.key}
      </LineKey>
      <LineToken>{member?.index === undefined ? ": " : "  "}</LineToken>
      {isEditing ? (
        // 带换行的值给多行输入（Enter 换行、Esc 撤销），其余是一行的官方输入框。
        multiline ? (
          <CompactTextField>
            <textarea
              autoFocus={!missing}
              rows={1}
              aria-label={owner.label}
              value={text}
              onChange={(event) => {
                owner.onEditText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  face.revert(line.path);
                  onEdit(undefined);
                }
              }}
            />
          </CompactTextField>
        ) : (
          <CompactInput>
            <Input
              autoFocus={!missing}
              type="text"
              aria-label={owner.label}
              placeholder={missing ? t("empty") : ""}
              value={text}
              onBlur={() => {
                if (!missing) onEdit(undefined);
              }}
              onChange={(event) => {
                owner.onEditText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !missing) onEdit(undefined);
                if (event.key === "Escape") {
                  face.revert(line.path);
                  onEdit(undefined);
                }
              }}
            />
          </CompactInput>
        )
      ) : null}
      {/* 编辑态只留输入框：原值不再在它旁边画一遍。 */}
      {isEditing || line.variantsStandIn ? null : (
        <span
          onClick={() => {
            if (editable) onEdit(key);
          }}
        >
          {renderField(owner)}
        </span>
      )}
      <VariantSelect
        control={line.variants}
        path={line.path}
        face={face}
        disabled={disabled}
        t={t}
      />
      {line.field.invalid === undefined ? null : <LineInvalid>{line.field.invalid}</LineInvalid>}
      {isEditing ? (
        // 编辑态：确认收起这一格的编辑、取消把值退回去——都在输入框旁边，不用记快捷键。
        <HoverActions data-role="actions" data-editing="true">
          <button
            type="button"
            aria-label={t("confirmEdit")}
            onClick={() => {
              onEdit(undefined);
            }}
          >
            <IconCheckOutlineRegular size={14} />
          </button>
          <button
            type="button"
            aria-label={t("cancelEdit")}
            onClick={() => {
              face.revert(line.path);
              onEdit(undefined);
              // 还没值的格子：取消就是先把输入框收起来（值本身没什么可退的）。
              onDismiss(key);
            }}
          >
            <IconCloseOutlineRegular size={14} />
          </button>
        </HoverActions>
      ) : null}
      <HoverActions data-role="actions">
        {line.field.staged && !disabled ? (
          <button
            type="button"
            onClick={() => {
              face.revert(line.path);
            }}
          >
            {t("revert")}
          </button>
        ) : null}
        {line.field.overridden && !line.field.staged && !disabled ? (
          <button
            type="button"
            onClick={() => {
              face.clear(line.path);
            }}
          >
            {t("reset")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(line.field.text ?? tokenFor(line.field.value))
              .catch(() => {});
          }}
        >
          {t("copyValue")}
        </button>
        {member === undefined ? null : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (member.index === undefined) face.removeKey(member.parent, member.key);
              else face.removeItem(member.parent, member.index);
            }}
          >
            {t("removeItem")}
          </button>
        )}
      </HoverActions>
    </>
  );
}

/** 复制用的文本（字符串带引号，粘到哪里都是合法片段）。 */
function tokenFor(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value ?? null);
}

/** 变体切换：判别式 union 挂在标签行上，按形状选的挂在字段行上。触发元素就是当前那一支。 */
function VariantSelect({
  control,
  path,
  face,
  disabled,
  t,
}: {
  control: VariantControl | undefined;
  path: readonly string[];
  face: SchemaFormFace;
  disabled: boolean;
  t: SchemaFormTranslate;
}): ReactNode {
  const [open, setOpen] = useState(false);
  if (control === undefined) return null;
  const current = control.choices[control.selected];
  return (
    <Menu
      open={open}
      dense
      compact
      portal
      align="start"
      items={control.choices.map((choice, index) => ({
        id: String(index),
        label: choice.label,
      }))}
      selectedId={String(control.selected)}
      onSelect={(id) => {
        setOpen(false);
        const choice = control.choices[Number(id)];
        if (choice !== undefined) face.set(path, choice.value);
      }}
      onClose={() => {
        setOpen(false);
      }}
      anchor={
        <ValueTrigger
          type="button"
          data-role="variant"
          disabled={disabled}
          aria-label={t("switchVariant")}
          onClick={() => {
            setOpen(true);
          }}
        >
          <LineValue data-tone="empty">{current?.label ?? ""}</LineValue>
        </ValueTrigger>
      }
    />
  );
}

/** 开启行的前缀：字段键名（对象里的一层）或数组成员的下标。 */
function LinePrefix({ line }: { line: Extract<EditorLine, { kind: "open" }> }): ReactNode {
  const member = line.member;
  const key = member?.key ?? line.node.key;
  // 根层的开启行没有键名，只有结构符。
  if (key === "") return null;
  const indexed = member !== undefined && member.index !== undefined;
  return (
    <>
      <LineKey data-index={indexed ? "true" : undefined}>{key}</LineKey>
      <LineToken>{indexed ? "  " : ": "}</LineToken>
    </>
  );
}

/**
 * 容器闭合行后面的添加入口。
 *
 * 数组是「追加一个空项」；对象/字典给出**候选**——对象列的是 schema 声明了、值里还没有的字段（带说明），
 * 字典列的是业务注册的候选键（还能自己敲键名）。粘一整段 `{…}` / `[…]` 则整层覆盖。
 */
function AddLine({
  line,
  state,
  face,
  t,
  resolveText,
  disabled,
  onAdded,
}: {
  line: Extract<EditorLine, { kind: "close" }>;
  state: SchemaFormState;
  face: SchemaFormFace;
  t: SchemaFormTranslate;
  resolveText: ResolveText;
  disabled: boolean;
  onAdded: (path: readonly string[]) => void;
}): ReactNode {
  const spec = line.add;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  if (spec === undefined || disabled) return null;
  const options = spec.kind === "item" ? [] : spec.options;
  const query = text.trim().toLowerCase();
  const matched = options.filter(
    (option) => query === "" || option.key.toLowerCase().includes(query),
  );
  const label =
    spec.kind === "item" ? t("addItemPaste") : spec.kind === "key" ? t("addKey") : t("addProperty");
  const commit = (picked?: string): void => {
    const raw = (picked ?? text).trim();
    if (raw === "") return;
    setInvalid(false);
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        face.set(line.path, JSON.parse(raw));
        setText("");
        setOpen(false);
        return;
      } catch {
        // 不是 JSON：当键名处理
      }
    }
    if (spec.kind === "key") {
      // 字典认任意键名。
      face.addKey(line.path, raw);
      onAdded([...line.path, raw]);
    } else if (spec.kind === "item") {
      const current = state.fields.get(fieldKey(line.path))?.value;
      const index = Array.isArray(current) ? current.length : 0;
      face.appendItem(line.path);
      onAdded([...line.path, String(index)]);
    } else {
      // 对象只认声明过的字段：名字不在这层声明的里就说清楚，别静默丢掉。
      if (!spec.options.some((option) => option.key === raw)) {
        setInvalid(true);
        return;
      }
      face.addKey(line.path, raw);
      onAdded([...line.path, raw]);
    }
    setText("");
    setOpen(false);
  };
  return (
    <AddWrap data-add={spec.kind} data-invalid={invalid ? "true" : undefined}>
      <Menu
        open={open && spec.kind !== "item" && matched.length > 0}
        dense
        compact
        portal
        align="start"
        items={matched.map((option) => ({ id: option.key, label: option.key }))}
        onSelect={(key) => {
          commit(key);
        }}
        onClose={() => {
          setOpen(false);
        }}
        anchor={
          <CompactInput>
            <Input
              value={text}
              placeholder={label}
              aria-label={label}
              disabled={disabled}
              onFocus={() => {
                setOpen(true);
              }}
              // 不监听失焦：候选菜单挂在 body 上，点它的那一瞬间输入框正好失焦——在这里收起菜单会把这
              // 一次点击吞掉。关菜单交给菜单自己（点外面 / Esc 都会走 onClose）。
              onChange={(event) => {
                setText(event.target.value);
                setInvalid(false);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(
                    matched.length === 1 && spec.kind === "prop" ? matched[0]?.key : undefined,
                  );
                }
                if (event.key === "Escape") {
                  setText("");
                  setOpen(false);
                }
              }}
            />
          </CompactInput>
        }
      />
      {invalid ? <LineInvalid>{t("unknownProperty")}</LineInvalid> : null}
      {/* 候选的说明：选中之前先看清"要加的是什么"。 */}
      {!invalid && matched.length === 1 && matched[0]?.description !== undefined ? (
        <LineComment>{resolveText(matched[0].description)}</LineComment>
      ) : null}
    </AddWrap>
  );
}

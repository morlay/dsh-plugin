// bundle 配置页：装这个 bundle 的那一行（`session-mode`）的完整配置——新会话的默认模式 + 每个模式一张可折叠卡片。
//
// 注册进 `plugins.bundle.config`（key = bundle 包名），读写的命名空间是 `session-mode`。草稿、整段校验与保存都归通用
// schema 表单的控制器（`bundle-config.ts` 的注入面），本文件只管布局与控件：控件一律用官方 primitives——文本字段是
// `SettingsValueField`（标签 / 说明 / "已覆盖" / 恢复默认 / 非法提示都在它里面），候选是 `Menu`，开关是 `Checkbox`，
// 三态是 `SegmentedControl`，名单是 `Input` + `Tag` 拼的标签输入。改动一律先落草稿，底部保存是唯一写盘点。

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  DisclosureRow,
  IconAgentPresetOutlineRegular,
  IconCloseOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Menu,
  Modal,
  SegmentedControl,
  SettingsForm,
  SettingsValueField,
  Switch,
  Tag,
  type MenuEntry,
  type SettingsFormLabels,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { SchemaFormState } from "@morlay/dsh-client-ui-primitives/client";
import {
  SESSION_MODE_NS,
  mergeTags,
  parseTagList,
  projectBundleConfig,
  ROLES,
  type BundleConfigActions,
  type BundleConfigFace,
  type ConfigStatus,
  type BundleFieldView,
  type BundleModeView,
  type BundleTranslate,
} from "./bundle-config.ts";
import { className, props as stylingProps, styles } from "./BundleConfigPage.styles.ts";

export type BundleConfigPageProps = PropsRuntime<"plugins.bundle.config"> &
  PropsLocale<"session-mode-bundle"> &
  InjectFace<BundleConfigFace>;

// tri 控件的三个档：`unset` 是"配置里没写这个键"（按工具名单推导），另两档是显式开关值。
type TriValue = "unset" | "on" | "off";

export function BundleConfigPage(props: BundleConfigPageProps): ReactNode {
  const { t, view } = props;
  // 子组件只收动作面：读数走框架绑好的 `useBundleConfig`，动作是同一份注入面里的函数。
  const face: BundleConfigActions = {
    set: props.set,
    editText: props.editText,
    clear: props.clear,
    appendItem: props.appendItem,
    removeItem: props.removeItem,
    addMode: props.addMode,
    removeMode: props.removeMode,
    save: props.save,
    discard: props.discard,
  };
  // 读数取原始快照（引用稳定，uSES 语义正确），投影在渲染里做。
  const snapshot = props.useBundleConfig((current: SchemaFormState) => current);
  const status = props.useBundleStatus((current: ConfigStatus) => current);
  const state = useMemo(() => projectBundleConfig(snapshot, t, status), [snapshot, t, status]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [adding, setAdding] = useState("");
  // 要删的那个模式：删除是不可逆的一步，先过一次确认弹窗（保存之前仍可丢弃）。
  const [removing, setRemoving] = useState<BundleModeView | null>(null);
  // 挂载时强制重读一次 describe：视图晚到、通知没落上时，这一步把读数拉平（有草稿时它自己跳过）。
  const resync = props.resync;
  useEffect(() => {
    resync();
  }, [resync]);
  // 槽位注册项只为 `page` 视图存在（bundle 页不给 `summary` 座位）。
  if (view !== "page") return null;
  if (state.readiness !== "ready") {
    // 只有异常态才做诊断（它读 describe 与 schema，正常路径一次也不跑）。
    const diagnosis = props.diagnose();
    const message =
      state.readiness === "loading"
        ? t("configured.loading")
        : state.readiness === "missing"
          ? t("configured.missing")
          : t("configured.unreadable", { problem: diagnosis.problem });
    return (
      <div data-bundle-config={state.readiness} data-namespace={SESSION_MODE_NS}>
        <p
          {...stylingProps(styles.hint)}
          data-namespaces={diagnosis.namespaces.join(",")}
          data-problem={diagnosis.problem}
          data-controller={diagnosis.controller}
        >
          {message}
        </p>
        {state.readiness !== "unreadable" ? null : (
          // 读不出来时把诊断也画出来：这时页面本来就用不了，原因说在明面上比藏在属性里有用。
          <p {...stylingProps(styles.diagnosis)} data-diagnosis="true">
            {`${diagnosis.problem} · ${diagnosis.controller} · namespaces=[${diagnosis.namespaces.join(", ")}]`}
          </p>
        )}
      </div>
    );
  }
  const labels: SettingsFormLabels = {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving"),
  };
  const toggle = (id: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <SettingsForm labels={labels} state={state} onSave={face.save} onDiscard={face.discard}>
      <div {...stylingProps(styles.root)} data-bundle-config="page">
        <section {...stylingProps(styles.section)} data-section="default">
          <div {...stylingProps(styles.defaultRow)}>
            <div {...stylingProps(styles.defaultText)}>
              <span {...stylingProps(styles.fieldLabel)}>{t("default.label")}</span>
              <p {...stylingProps(styles.fieldHint)}>{t("default.hint")}</p>
            </div>
            <PickMenu
              label={t("default.label")}
              value={state.defaultMode.value}
              emptyLabel={t("tri.unset")}
              options={state.defaultMode.options}
              disabled={!state.writable}
              onPick={(next) => {
                if (next === "") face.clear(["default"]);
                else face.set(["default"], next);
              }}
            />
          </div>
          {state.defaultMode.invalid === undefined ? null : (
            <p {...stylingProps(styles.invalid)} role="alert" data-invalid="default">
              {state.defaultMode.invalid}
            </p>
          )}
        </section>

        <section {...stylingProps(styles.section)} data-section="modes">
          <h4 {...stylingProps(styles.sectionTitle)}>{t("modes.label")}</h4>
          <p {...stylingProps(styles.hint)}>{t("modes.hint")}</p>
          {state.modes.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              open={expanded.has(mode.id)}
              writable={state.writable}
              t={t}
              face={face}
              onRequestRemove={() => {
                setRemoving(mode);
              }}
              onToggle={() => {
                toggle(mode.id);
              }}
            />
          ))}
          <div {...stylingProps(styles.addRow)}>
            <Input
              className={className(styles.addInput)}
              data-field="new-mode"
              value={adding}
              placeholder={t("add.placeholder")}
              aria-label={t("add.label")}
              disabled={!state.writable}
              onChange={(event) => {
                setAdding(event.currentTarget.value);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className={className(styles.controlHeight)}
              data-action="add-mode"
              disabled={!state.writable || adding.trim() === ""}
              onClick={() => {
                const id = adding.trim();
                face.addMode(id);
                setAdding("");
                setExpanded((previous) => new Set(previous).add(id));
              }}
            >
              {t("add.confirm")}
            </Button>
          </div>
        </section>
      </div>
      <Modal
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
        }}
        title={t("remove.title")}
        closeLabel={t("remove.close")}
        description={t("remove.description", { name: removing?.title ?? "" })}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRemoving(null);
              }}
            >
              {t("remove.cancel")}
            </Button>
            <Button
              variant="primary"
              className={className(styles.dangerFill)}
              data-action="confirm-remove"
              onClick={() => {
                if (removing !== null) face.removeMode(removing.id);
                setRemoving(null);
              }}
            >
              {t("remove.confirm")}
            </Button>
          </>
        }
      />
    </SettingsForm>
  );
}

// 一张模式卡片：折叠头显示名称与摘要，展开后是分组字段与删除入口。
function ModeCard({
  mode,
  open,
  writable,
  t,
  face,
  onRequestRemove,
  onToggle,
}: {
  mode: BundleModeView;
  open: boolean;
  writable: boolean;
  t: BundleTranslate;
  face: BundleConfigActions;
  // 删除要过确认弹窗：卡片只上报"想删这一个"，真正删谁由页面在弹窗里定。
  onRequestRemove: () => void;
  onToggle: () => void;
}): ReactNode {
  const model = mode.groups.find((group) => group.key === "model");
  const hasModel = model?.fields.some((field) => field.present) === true;
  return (
    <div
      {...stylingProps(styles.modeCard)}
      data-mode={mode.id}
      data-deletable={mode.deletable ? "true" : "false"}
    >
      <DisclosureRow
        icon={<IconAgentPresetOutlineRegular />}
        title={mode.title}
        open={open}
        expandable
        expandOnRowClick
        onToggle={onToggle}
        keepContentWhenOpen
        contentClassName={className(styles.disclosureRoot)}
        contentLayoutClassName={className(styles.disclosureContent)}
        collapsedContent={
          // 两段：先是紧挨名称的 id，再是贴最右的摘要 + 删除。
          <>
            <code {...stylingProps(styles.modeId)} data-mode-id>
              {mode.id}
            </code>
            <span {...stylingProps(styles.modeHeadAside)}>
              <span {...stylingProps(styles.modeSummary)}>{mode.summary}</span>
              {mode.deletable ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={className(styles.dangerOutline)}
                  data-action="remove-mode"
                  disabled={!writable}
                  icon={<IconTrashOutlineRegular size={13} />}
                  aria-label={t("removeNamed", { name: mode.title })}
                  onClick={(event) => {
                    // 行本身是折叠开关：删除先拦下这次点击，别顺手把卡片收起来（确认弹窗照旧）。
                    event.stopPropagation();
                    onRequestRemove();
                  }}
                />
              ) : (
                <span {...stylingProps(styles.protectedNote)} data-protected="true">
                  {t("protected")}
                </span>
              )}
            </span>
          </>
        }
      >
        <div {...stylingProps(styles.modeBody)}>
          {mode.groups.map((group) => (
            <div key={group.key} {...stylingProps(styles.group)} data-group={group.key}>
              <div {...stylingProps(styles.groupHead)}>
                <span {...stylingProps(styles.groupTitle)}>{group.label}</span>
                {group.key !== "model" ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    data-action={hasModel ? "clear-model" : "set-model"}
                    disabled={!writable}
                    onClick={() => {
                      // 整个 `defaultModel` 是一个可加字段：没有就是跟随全局，清掉它同样回到跟随全局。
                      if (hasModel) face.clear(["modes", mode.id, "defaultModel"]);
                      else
                        face.set(["modes", mode.id, "defaultModel"], { provider: "", model: "" });
                    }}
                  >
                    {hasModel ? t("model.follow") : t("model.set")}
                  </Button>
                )}
              </div>
              {group.fields.map((field, index) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  writable={writable}
                  t={t}
                  face={face}
                  divider={index > 0}
                />
              ))}
            </div>
          ))}
        </div>
      </DisclosureRow>
    </div>
  );
}

// 一个字段：文本字段交给官方 `SettingsValueField`（标签、说明、覆盖标记、恢复默认与非法提示都在它里面），其余控件
// 用同一套「标签一行（或控件自带标签）、控件一行、说明一行」的块。
function FieldRow({
  field,
  writable,
  divider,
  t,
  face,
}: {
  field: BundleFieldView;
  writable: boolean;
  // 不是这一组的第一个字段：与上一个之间画一条细分隔线（与官方设置面同一种口径）。
  divider: boolean;
  t: BundleTranslate;
  face: BundleConfigActions;
}): ReactNode {
  const id = useId();
  const container = {
    ...stylingProps(styles.field),
    ...stylingProps(divider ? styles.fieldDivider : {}),
    "data-field": field.path.join("."),
    "data-control": field.control,
    "data-divider": divider ? "true" : "false",
  };
  if (field.control === "text") {
    // 官方 `SettingsValueField` 自带标签 / 说明 / 覆盖标记 / 恢复默认与 12px 上下留白。
    return (
      <div {...container}>
        <SettingsValueField
          id={`${id}-${field.key}`}
          label={field.label}
          hint={field.hint}
          text={field.text}
          overridden={field.overridden}
          invalid={field.invalid !== undefined}
          overriddenLabel={t("overridden")}
          resetLabel={t("field.reset")}
          invalidLabel={field.invalid ?? ""}
          disabled={!writable}
          onEdit={(text) => {
            face.editText(field.path, text);
          }}
          onReset={() => {
            face.clear(field.path);
          }}
        />
      </div>
    );
  }
  const label = (
    <span {...stylingProps(styles.fieldLabel)}>
      {field.label}
      {field.overridden ? <Tag tone="neutral">{t("overridden")}</Tag> : null}
    </span>
  );
  const invalid =
    field.invalid === undefined ? null : (
      <p {...stylingProps(styles.invalid)} role="alert" data-invalid={field.path.join(".")}>
        {field.invalid}
      </p>
    );
  // 开关 / 三态 / 多选按钮：控件贴右，标签与说明在左（与官方设置页的开关行同一种排法）。
  if (field.control === "switch" || field.control === "tri" || field.control === "roles") {
    return (
      <div {...container}>
        <div {...stylingProps(styles.fieldInline)}>
          <div {...stylingProps(styles.fieldText)}>
            {label}
            <p {...stylingProps(styles.fieldHint)}>{field.hint}</p>
          </div>
          <FieldControl field={field} writable={writable} t={t} face={face} />
        </div>
        {invalid}
      </div>
    );
  }
  return (
    <div {...container}>
      <div {...stylingProps(styles.fieldBody)}>
        {label}
        <FieldControl field={field} writable={writable} t={t} face={face} />
        {invalid}
        <p {...stylingProps(styles.fieldHint)}>{field.hint}</p>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  writable,
  t,
  face,
}: {
  field: BundleFieldView;
  writable: boolean;
  t: BundleTranslate;
  face: BundleConfigActions;
}): ReactNode {
  const disabled = !writable;
  const id = useId();
  switch (field.control) {
    case "multiline":
      // 官方表单没有多行控件（`SettingsValueField` 是单行）：按官方输入框的 token 画一个。
      return (
        <textarea
          {...stylingProps(styles.multiline)}
          data-control="multiline"
          value={field.text}
          rows={3}
          disabled={disabled}
          aria-label={field.label}
          onChange={(event) => {
            face.editText(field.path, event.currentTarget.value);
          }}
        />
      );
    case "choice":
      // 没有候选的情况在 `FieldRow` 里就转成了官方文本控件（见那里的 `asValueField`）。
      return (
        <PickMenu
          label={field.label}
          value={field.text}
          emptyLabel={t("tri.unset")}
          options={field.options}
          disabled={disabled}
          onPick={(next) => {
            if (next === "") face.clear(field.path);
            else face.set(field.path, next);
          }}
        />
      );
    case "switch":
      return (
        <Switch
          checked={field.value === true}
          label={field.label}
          disabled={disabled}
          onChange={(next) => {
            face.set(field.path, next);
          }}
        />
      );
    case "tri":
      return (
        <SegmentedControl<TriValue>
          id={`${id}-tri`}
          label={field.label}
          value={triValue(field)}
          disabled={disabled}
          options={[
            { value: "unset", label: t("tri.unset") },
            { value: "on", label: t("tri.on") },
            { value: "off", label: t("tri.off") },
          ]}
          onChange={(next) => {
            if (next === "unset") face.clear(field.path);
            else face.set(field.path, next === "on");
          }}
        />
      );
    case "roles":
      return (
        <div {...stylingProps(styles.roles)} data-control="roles">
          {ROLES.map((role) => {
            const active = Array.isArray(field.value) && field.value.includes(role);
            return (
              <Button
                key={role}
                variant={active ? "primary" : "outline"}
                size="sm"
                data-role={role}
                disabled={disabled}
                aria-pressed={active}
                onClick={() => {
                  const current = Array.isArray(field.value) ? field.value.map(String) : [];
                  const wanted = active
                    ? current.filter((value) => value !== role)
                    : [...current.filter((value) => value !== role), role];
                  face.set(field.path, wanted);
                }}
              >
                {t(`role.${role}` as "role.main")}
              </Button>
            );
          })}
        </div>
      );
    case "tags":
      return <TagList field={field} disabled={disabled} t={t} face={face} />;
    case "text":
      return null;
  }
}

// 名单字段：标签输入。回车确认一个；**粘贴逗号分隔的一串会拆成多个**（中英逗号、分号、换行、制表符都是分隔符）；
// 有候选的名单（两份 policy）另给一个「从候选里选」的菜单。
function TagList({
  field,
  disabled,
  t,
  face,
}: {
  field: BundleFieldView;
  disabled: boolean;
  t: BundleTranslate;
  face: BundleConfigActions;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const values = Array.isArray(field.value) ? field.value.map(String) : [];
  const commit = (text: string): void => {
    const names = parseTagList(text);
    if (names.length === 0) return;
    face.set(field.path, mergeTags(values, names));
    setDraft("");
  };
  const remaining = field.options.filter((option) => !values.includes(String(option.value)));
  return (
    <div {...stylingProps(styles.tagRow)} data-control="tags">
      <div {...stylingProps(styles.chips)} data-tags={field.path.join(".")}>
        {values.map((value) => (
          // 胶囊与里面的"移除"是同一个整体：× 在框内，点它才删。
          <span key={value} {...stylingProps(styles.tagChip)} data-tag={value}>
            {value}
            <button
              type="button"
              {...stylingProps(styles.tagRemove)}
              data-action="remove-tag"
              disabled={disabled}
              aria-label={t("tags.remove", { name: value })}
              onClick={() => {
                face.set(
                  field.path,
                  values.filter((candidate) => candidate !== value),
                );
              }}
            >
              <IconCloseOutlineRegular size={12} />
            </button>
          </span>
        ))}
        {/* 裸输入：边框与背景归外面那个框，标签与它一起换行。 */}
        <input
          {...stylingProps(styles.chipInput)}
          data-tags-input={field.path.join(".")}
          value={draft}
          placeholder={values.length === 0 ? t("tags.placeholder") : ""}
          aria-label={field.label}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit(draft);
          }}
          onPaste={(event) => {
            // 只有真的一串才拦：单个名字照旧走普通输入（粘进去还能接着改）。
            const text = event.clipboardData.getData("text");
            if (parseTagList(text).length < 2) return;
            event.preventDefault();
            commit(text);
          }}
        />
      </div>
      {remaining.length === 0 ? null : (
        <PickMenu
          label={t("tags.candidates")}
          value=""
          emptyLabel={t("tags.candidates")}
          options={remaining}
          disabled={disabled}
          onPick={(next) => {
            if (next !== "") commit(next);
          }}
        />
      )}
    </div>
  );
}

// 一个候选菜单（官方 `Menu`）：触发按钮显示当前值，菜单里选一个。`emptyLabel` 那一项是"不写"。
function PickMenu({
  label,
  value,
  emptyLabel,
  options,
  disabled,
  onPick,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  options: readonly { value: unknown; label?: string | undefined }[];
  disabled: boolean;
  onPick: (next: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const items: readonly MenuEntry[] = [
    { id: "", label: emptyLabel },
    ...options.map((option) => ({
      id: String(option.value),
      label: option.label ?? String(option.value),
    })),
  ];
  const current = options.find((option) => String(option.value) === value);
  return (
    <Menu
      open={open}
      anchor={
        <Button
          variant="outline"
          size="sm"
          className={className(styles.controlHeight)}
          data-action="pick"
          disabled={disabled}
          aria-haspopup="menu"
          aria-label={label}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {value === "" ? emptyLabel : (current?.label ?? value)}
        </Button>
      }
      items={items}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false);
        onPick(id);
      }}
      onClose={() => {
        setOpen(false);
      }}
    />
  );
}

function triValue(field: BundleFieldView): TriValue {
  return field.value === "unset" || field.value === "on" || field.value === "off"
    ? field.value
    : "unset";
}
